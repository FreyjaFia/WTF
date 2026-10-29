import { Api } from '@api/index';
import { StockExtraApi, linkAddOnsReliably } from '@api/stock-extra';
import { AddOnType, OrderStatus } from '@data/enums';
import { expect, test } from '@fixtures/index';
import { unique } from '@utils/unique';

function addOn(productId: string, quantity: number = 1) {
  return { productId, quantity, addOns: [], specialInstructions: null, bundlePromotionId: null };
}

async function drinkWithSizes(api: Api, sizeCount: number = 1) {
  const drink = await api.products.create({ price: 100 });
  const sizes = [];
  for (let index = 0; index < sizeCount; index++) {
    sizes.push(await api.products.create({ isAddOn: true, price: 10 * (index + 1), name: unique(`E2E Size ${index}`) }));
  }

  await linkAddOnsReliably(
    api.client,
    drink.id,
    sizes.map((size) => ({ addOnId: size.id, addOnType: AddOnType.Size })),
  );
  return { drink, sizes };
}

test.describe('order-time stock deduction @stock', () => {
  test('several lines sharing one item and an add-on per unit of the parent are summed per item', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const { drink: drinkA, sizes } = await drinkWithSizes(api);
    const drinkB = await api.products.create({ price: 80 });
    const item = await api.items.create({ startingQuantity: 100 });
    await api.items.linkProducts(item.id, [
      { productId: drinkA.id, quantityPerSale: 2 },
      { productId: drinkB.id, quantityPerSale: 3 },
      { productId: sizes[0].id, quantityPerSale: 1 },
    ]);

    const order = await api.orders.create({
      items: [{ productId: drinkA.id, quantity: 2, addOns: [addOn(sizes[0].id, 1)] }, { productId: drinkB.id, quantity: 1 }],
    });

    // 2 drinks x 2 + 1 drink x 3 + 1 size per drink x 2 drinks = 9
    expect(await api.items.balance(item.id)).toBe(91);
    const sales = (await extra.movementRows(item.id)).filter((row) => row.movementType === 'Sale');
    expect(sales.reduce((sum, row) => sum + row.quantityDelta, 0)).toBe(-9);
    expect(sales.map((row) => row.productId).sort()).toEqual([drinkA.id, drinkB.id, sizes[0].id].sort());
    expect((await api.orders.stockMovements(order.id)).length).toBeGreaterThanOrEqual(3);
  });

  test('a Pending order takes nothing, completing it takes once, and saving a completed order again does not deduct twice', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 20 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 3 }]);

    const pending = await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }], status: OrderStatus.Pending });
    expect(await api.items.balance(item.id)).toBe(20);
    expect(await api.orders.stockMovements(pending.id)).toHaveLength(0);

    const completed = await extra.updateOrderRaw(pending.id, { items: [{ productId: drink.id, quantity: 2 }] });
    expect(completed.ok(), await completed.text()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(14);

    const again = await extra.updateOrderRaw(pending.id, { items: [{ productId: drink.id, quantity: 2 }] });
    expect(again.ok()).toBe(false);
    expect(await api.items.balance(item.id)).toBe(14);
    const sales = (await extra.movementRows(item.id)).filter((row) => row.movementType === 'Sale');
    expect(sales).toHaveLength(1);
  });

  test('a Pending order that changes quantity before completing still takes only what it finally holds', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 20 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 2 }]);

    const pending = await api.orders.create({ items: [{ productId: drink.id, quantity: 5 }], status: OrderStatus.Pending });
    const saved = await extra.updateOrderRaw(pending.id, { items: [{ productId: drink.id, quantity: 1 }], status: OrderStatus.Pending });
    expect(saved.ok()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(20);

    const done = await extra.updateOrderRaw(pending.id, { items: [{ productId: drink.id, quantity: 1 }] });
    expect(done.ok()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(18);
  });

  test('voiding restores from the original movements even after the link quantity changed', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 40 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 2 }]);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 3 }] });
    expect(await api.items.balance(item.id)).toBe(34);

    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 5 }]);
    const voided = await api.orders.voidOrder(order.id, 'Customer left');
    expect(voided.ok(), await voided.text()).toBeTruthy();

    expect(await api.items.balance(item.id)).toBe(40);
    const rows = (await extra.movementRows(item.id)).filter((row) => row.movementType === 'SaleVoid');
    expect(rows.reduce((sum, row) => sum + row.quantityDelta, 0)).toBe(6);
  });

  test('voiding a Pending order restores nothing', async ({ api }) => {
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 40 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 2 }]);
    const pending = await api.orders.create({ items: [{ productId: drink.id, quantity: 3 }], status: OrderStatus.Pending });

    await api.orders.voidOrder(pending.id, 'Changed mind');
    expect(await api.items.balance(item.id)).toBe(40);
    expect(await api.orders.stockMovements(pending.id)).toHaveLength(0);
  });

  test('an Admin override of a completed order writes only the net difference', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 50 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 3 }]);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }] });
    expect(await api.items.balance(item.id)).toBe(44);

    const more = await extra.overrideOrderRaw(order.id, { items: [{ productId: drink.id, quantity: 3 }] }, 'Customer added one');
    expect(more.ok(), await more.text()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(41);
    let rows = await extra.movementRows(item.id);
    expect(rows.filter((row) => row.movementType === 'Sale').map((row) => row.quantityDelta).sort((a, b) => a - b)).toEqual([-6, -3]);

    const fewer = await extra.overrideOrderRaw(order.id, { items: [{ productId: drink.id, quantity: 1 }] }, 'Two were returned');
    expect(fewer.ok(), await fewer.text()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(47);
    rows = await extra.movementRows(item.id);
    expect(rows.filter((row) => row.movementType === 'SaleVoid').reduce((sum, row) => sum + row.quantityDelta, 0)).toBe(6);
  });

  test('an override needs a reason and the Admin role', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 50 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 3 }]);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }] });

    const noReason = await extra.overrideOrderRaw(order.id, { items: [{ productId: drink.id, quantity: 3 }] }, '');
    expect(noReason.ok()).toBe(false);
    const cashier = await extra.overrideOrderRaw(order.id, { items: [{ productId: drink.id, quantity: 3 }] }, 'Because', 'cashier');
    expect(cashier.status()).toBe(403);
    expect(await api.items.balance(item.id)).toBe(44);
  });

  test('a blocking item refuses the sale online, names the item and the shortfall, and the whole order rolls back', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const plain = await api.products.create({ price: 50 });
    const scarce = await api.products.create({ price: 70 });
    const plainItem = await api.items.create({ startingQuantity: 10 });
    const scarceItem = await api.items.create({ startingQuantity: 1, allowNegativeStock: false });
    await api.items.linkProducts(plainItem.id, [{ productId: plain.id, quantityPerSale: 1 }]);
    await api.items.linkProducts(scarceItem.id, [{ productId: scarce.id, quantityPerSale: 1 }]);

    const response = await api.orders.createRaw({
      items: [
        { productId: plain.id, quantity: 2 },
        { productId: scarce.id, quantity: 3 },
      ],
    });
    expect(response.status()).toBe(400);
    const message = await response.text();
    expect(message).toContain('Not enough');
    expect(message).toContain(scarceItem.name);
    expect(message).toContain('short by 2');

    expect(await api.items.balance(plainItem.id)).toBe(10);
    expect(await api.items.balance(scarceItem.id)).toBe(1);
    expect((await extra.movementRows(plainItem.id)).filter((row) => row.movementType === 'Sale')).toHaveLength(0);
  });

  test('a warn-only item lets the sale through, goes below zero, notes it and warns', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 70 });
    const item = await api.items.create({ startingQuantity: 1, allowNegativeStock: true });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const response = await api.orders.createRaw({ items: [{ productId: drink.id, quantity: 3 }] });
    expect(response.ok()).toBeTruthy();
    const order = await response.json();
    expect(order.stockWarnings.join(' ')).toContain(`${item.name} is below zero`);
    expect(await api.items.balance(item.id)).toBe(-2);
    const sale = (await extra.movementRows(item.id)).find((row) => row.movementType === 'Sale');
    expect(sale?.notes).toBe('Balance went below zero');
  });
});

test.describe('offline sales and stock @stock @offline', () => {
  test('an offline sale of a blocking item is honoured, goes negative and is saved once even if sent twice', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 60 });
    const item = await api.items.create({ startingQuantity: 2, allowNegativeStock: false });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const localId = `E2E-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    const body = api.orders.body({ items: [{ productId: drink.id, quantity: 3 }] });
    const [first] = await extra.syncOffline([{ body, localId }]);

    expect(first.error).toBeNull();
    expect(first.status).toBe(OrderStatus.Completed);
    expect(first.stockWarnings?.join(' ')).toContain('below zero');
    expect(await api.items.balance(item.id)).toBe(-1);
    const sale = (await extra.movementRows(item.id)).find((row) => row.movementType === 'Sale');
    expect(sale?.notes).toBe('Balance went below zero');

    const [second] = await extra.syncOffline([{ body, localId }]);
    expect(second.orderId).toBe(first.orderId);
    expect(await api.items.balance(item.id)).toBe(-1);
    expect((await extra.movementRows(item.id)).filter((row) => row.movementType === 'Sale')).toHaveLength(1);

    // The item still blocks: the next sale made online is refused.
    const online = await api.orders.createRaw({ items: [{ productId: drink.id, quantity: 1 }] });
    expect(online.status()).toBe(400);
    expect(await online.text()).toContain('Not enough');
  });

  test('one bad order in a sync does not stop the next one', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 60 });
    const item = await api.items.create({ startingQuantity: 5 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);
    const stamp = Date.now().toString(36);

    const results = await extra.syncOffline([
      { body: api.orders.body({ items: [{ productId: '00000000-0000-0000-0000-000000000001', quantity: 1 }] }), localId: `E2E-${stamp}-bad` },
      { body: api.orders.body({ items: [{ productId: drink.id, quantity: 2 }] }), localId: `E2E-${stamp}-good` },
    ]);

    expect(results[0].error).not.toBeNull();
    expect(results[1].error).toBeNull();
    expect(await api.items.balance(item.id)).toBe(3);
  });
});

test.describe('inactive items and stock limits @stock', () => {
  test('a sale that skips an inactive item returns the warning and leaves the balance alone', async ({ api }) => {
    const drink = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 10 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);
    await api.products.remove(drink.id);
    await api.items.remove(item.id);
    await api.products.restore(drink.id);

    const response = await api.orders.createRaw({ items: [{ productId: drink.id, quantity: 1 }] });
    expect(response.ok(), await response.text()).toBeTruthy();
    const order = await response.json();
    expect(order.stockWarnings).toContain(`${item.name} is inactive, so this sale did not take stock from it.`);
    expect(await api.items.balance(item.id)).toBe(10);
  });

  test('stock limits list only active blocking items, their balances and links, and no costs', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create({ price: 90 });
    const blocking = await api.items.create({ startingQuantity: 4, allowNegativeStock: false, costPrice: 77 });
    const warnOnly = await api.items.create({ startingQuantity: 4, allowNegativeStock: true });
    const retired = await api.items.create({ startingQuantity: 4, allowNegativeStock: false });
    await api.items.linkProducts(blocking.id, [{ productId: drink.id, quantityPerSale: 2 }]);
    await api.items.linkProducts(warnOnly.id, [{ productId: drink.id, quantityPerSale: 1 }]);
    await api.items.remove(retired.id);

    const limits = await extra.stockLimits('cashier');
    const ids = limits.items.map((item) => item.id);
    expect(ids).toContain(blocking.id);
    expect(ids).not.toContain(warnOnly.id);
    expect(ids).not.toContain(retired.id);

    const row = limits.items.find((item) => item.id === blocking.id)!;
    expect(row.balance).toBe(4);
    expect(row.name).toBe(blocking.name);
    expect(Object.keys(row).sort()).toEqual(['balance', 'id', 'name', 'unitName']);
    expect(limits.links).toContainEqual({ productId: drink.id, itemId: blocking.id, quantityPerSale: 2 });
    expect(limits.links.some((link) => link.itemId === warnOnly.id)).toBe(false);
    expect(JSON.stringify(limits)).not.toContain('costPrice');
  });

  test('stock limits need a login and are open to any order-writing role', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    expect((await api.client.call(null, 'GET', 'pos/stock-limits')).status()).toBe(401);
    expect((await api.client.call('admin', 'GET', 'pos/stock-limits')).ok()).toBeTruthy();
    expect((await extra.stockLimits('cashier')).items).toBeDefined();
    expect((await api.client.call('viewer', 'GET', 'pos/stock-limits')).status()).toBe(403);
  });
});

test.describe('stock coverage @stock', () => {
  test('a product with nothing linked takes no stock, one linked directly is covered', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const plain = await api.products.create();
    const linked = await api.products.create();
    const item = await api.items.create();
    await api.items.linkProducts(item.id, [{ productId: linked.id, quantityPerSale: 1 }]);

    expect((await extra.coverageOf(plain.id))?.status).toBe('Missing');
    const covered = await extra.coverageOf(linked.id);
    expect(covered?.status).toBe('Covered');
    expect(covered?.missingOptions).toEqual([]);
  });

  test('a product whose Size options are only partly linked is partial and names the missing size', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const { drink, sizes } = await drinkWithSizes(api, 2);
    const cup = await api.items.create();
    expect((await extra.coverageOf(drink.id))?.status).toBe('Missing');

    await api.items.linkProducts(cup.id, [{ productId: sizes[0].id, quantityPerSale: 1 }]);
    const partial = await extra.coverageOf(drink.id);
    expect(partial?.status).toBe('Partial');
    expect(partial?.missingOptions.join(' ')).toContain(sizes[1].name);
    expect(partial?.missingOptions.join(' ')).not.toContain(sizes[0].name);

    await api.items.linkProducts(cup.id, [
      { productId: sizes[0].id, quantityPerSale: 1 },
      { productId: sizes[1].id, quantityPerSale: 1 },
    ]);
    const full = await extra.coverageOf(drink.id);
    expect(full?.status).toBe('Covered');
    expect(full?.missingOptions).toEqual([]);
  });

  test('an unlinked optional add-on does not make a covered product partial', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create();
    const topping = await api.products.create({ isAddOn: true, price: 15, name: unique('E2E Topping') });
    await linkAddOnsReliably(api.client, drink.id, [{ addOnId: topping.id, addOnType: AddOnType.Topping }]);
    const item = await api.items.create();
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    expect((await extra.coverageOf(drink.id))?.status).toBe('Covered');
  });

  test('a link to an inactive item does not count as coverage', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create();
    const item = await api.items.create();
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);
    expect((await extra.coverageOf(drink.id))?.status).toBe('Covered');

    await api.items.linkProducts(item.id, []);
    await api.items.remove(item.id);
    expect((await extra.coverageOf(drink.id))?.status).toBe('Missing');
  });

  test('coverage needs item read rights', async ({ api }) => {
    expect((await api.client.call('cashier', 'GET', 'items/coverage')).status()).toBe(403);
    expect((await api.client.call('viewer', 'GET', 'items/coverage')).ok()).toBeTruthy();
  });
});
