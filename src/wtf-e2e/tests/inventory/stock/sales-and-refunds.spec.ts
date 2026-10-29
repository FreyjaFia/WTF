import { expect, test } from '@fixtures/index';
import { REFUND_NOT_RESALEABLE_NOTE } from '@data/enums';

test.describe('stock changes from sales and refunds @stock', () => {
  test('selling takes stock and refunding as returned puts it back', async ({ api }) => {
    const drink = await api.products.create({ price: 120 });
    const item = await api.items.create({ startingQuantity: 20 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 2 }]);

    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 3 }] });
    expect(await api.items.balance(item.id)).toBe(14);

    const response = await api.orders.voidOrder(order.id, 'Customer changed mind');
    expect(response.ok()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(20);
  });

  test('refunding a line as not returned keeps the stock down and writes a waste movement', async ({ api }) => {
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 10 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }] });
    const lineIds = order.items.map((line) => line.id);
    const response = await api.orders.voidOrder(order.id, 'Made wrong', lineIds);
    expect(response.ok()).toBeTruthy();

    expect(await api.items.balance(item.id)).toBe(8);
    const movements = await api.items.movements(item.id);
    expect(movements.some((m) => (m.movementType ?? m.type) === 'Waste' && m.notes === REFUND_NOT_RESALEABLE_NOTE)).toBeTruthy();
  });

  test('refund waste stays out of the waste list', async ({ api }) => {
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 10 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });
    await api.orders.voidOrder(order.id, 'Made wrong', order.items.map((line) => line.id));

    const entries = await api.waste.list(`itemId=${item.id}`);
    expect(entries.items).toHaveLength(0);
  });

  test('a blocking item refuses a sale it cannot cover', async ({ api }) => {
    const drink = await api.products.create({ price: 80 });
    const item = await api.items.create({ startingQuantity: 1, allowNegativeStock: false });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const response = await api.orders.createRaw({ items: [{ productId: drink.id, quantity: 2 }] });
    expect(response.status()).toBe(400);
    expect(await api.items.balance(item.id)).toBe(1);
  });
});
