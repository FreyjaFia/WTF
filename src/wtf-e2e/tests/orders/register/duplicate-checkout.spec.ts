import { expect, test } from '@fixtures/index';

test.describe('repeating a checkout after a lost response @orders @stock', () => {
  test('the same checkout key answers with the order already saved and takes stock only once', async ({ api }) => {
    const drink = await api.products.create({ price: 100 });
    const item = await api.items.create({ startingQuantity: 20 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 3 }]);
    const body = { ...api.orders.body({ items: [{ productId: drink.id, quantity: 1 }] }), offlineLocalId: `ON-${crypto.randomUUID().replaceAll('-', '')}` };

    const first = await api.client.call('cashier', 'POST', 'orders', { body });
    const second = await api.client.call('cashier', 'POST', 'orders', { body });

    expect(first.status()).toBe(201);
    expect(second.status()).toBe(200);
    expect((await second.json()).id).toBe((await first.json()).id);
    expect(await api.items.balance(item.id)).toBe(17);
  });

  test('a different checkout key is a new order', async ({ api }) => {
    const drink = await api.products.create({ price: 100 });
    const base = api.orders.body({ items: [{ productId: drink.id, quantity: 1 }] });

    const first = await api.client.call('cashier', 'POST', 'orders', { body: { ...base, offlineLocalId: `ON-${crypto.randomUUID().replaceAll('-', '')}` } });
    const second = await api.client.call('cashier', 'POST', 'orders', { body: { ...base, offlineLocalId: `ON-${crypto.randomUUID().replaceAll('-', '')}` } });

    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);
    expect((await second.json()).id).not.toBe((await first.json()).id);
  });
});
