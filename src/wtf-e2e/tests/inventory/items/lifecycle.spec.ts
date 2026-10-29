import { StockExtraApi } from '@api/stock-extra';
import { expect, test } from '@fixtures/index';
import { unique, uniqueCode } from '@utils/unique';

async function textOf(response: { text(): Promise<string> }): Promise<string> {
  return response.text();
}

test.describe('item delete and restore rules @stock @items', () => {
  test('deleting an item that an active product still uses is refused naming the product, and works after unlinking', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create();
    const item = await api.items.create({ startingQuantity: 30 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 2 }]);

    const refused = await extra.deleteRaw(item.id);
    expect(refused.status()).toBe(400);
    const message = await textOf(refused);
    expect(message).toContain(drink.name);
    expect(message).toContain('still used by 1 product');
    expect(message).toContain('Unlink');
    expect((await api.items.get(item.id)).isActive).toBe(true);

    await api.items.linkProducts(item.id, []);
    expect((await extra.deleteRaw(item.id)).ok()).toBeTruthy();
    expect((await api.items.get(item.id)).isActive).toBe(false);
  });

  test('switching an item off in the editor call is refused the same way while a product uses it', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create();
    const item = await api.items.create({ startingQuantity: 30 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const refused = await extra.updateRaw(item.id, { isActive: false });
    expect(refused.status()).toBe(400);
    expect(await textOf(refused)).toContain(drink.name);
    expect((await api.items.get(item.id)).isActive).toBe(true);
  });

  test('a link to a deleted product does not block deleting the item', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create();
    const item = await api.items.create({ startingQuantity: 30 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);
    await api.products.remove(drink.id);

    expect((await extra.deleteRaw(item.id)).ok()).toBeTruthy();
    expect((await api.items.get(item.id)).isActive).toBe(false);
  });

  test('restoring an item brings it back with its balance and its links', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const drink = await api.products.create();
    const item = await api.items.create({ startingQuantity: 30 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 2 }]);
    await api.items.linkProducts(item.id, []);
    await api.items.remove(item.id);

    await api.items.restore(item.id);
    const restored = await extra.fullItem(item.id);
    expect(restored.isActive).toBe(true);
    expect(restored.currentQuantity).toBe(30);
  });

  test('restoring an item that is still low alerts again', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 10, warningQuantity: 20, criticalQuantity: 3 });
    await expect.poll(async () => (await extra.alertsFor(item.id)).length).toBe(1);

    await api.items.remove(item.id);
    await api.items.restore(item.id);

    await expect.poll(async () => (await extra.alertsFor(item.id)).length).toBe(2);
  });

  test('stock in and adjust on an inactive item are refused with a restore hint', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 10 });
    await api.items.remove(item.id);

    const stockIn = await extra.stockInRaw(item.id, 5);
    expect(stockIn.status()).toBe(400);
    expect(await textOf(stockIn)).toContain('Restore it');

    const adjust = await extra.adjustRaw(item.id, { countedQuantity: 3, reason: 'Count correction' });
    expect(adjust.status()).toBe(400);
    expect(await textOf(adjust)).toContain('Restore it');

    expect(await api.items.balance(item.id)).toBe(10);
  });

  test('a viewer cannot delete or restore an item', async ({ api }) => {
    const item = await api.items.create();
    expect((await api.client.call('viewer', 'DELETE', `items/${item.id}`)).status()).toBe(403);
    await api.items.remove(item.id);
    expect((await api.client.call('viewer', 'POST', `items/${item.id}/restore`)).status()).toBe(403);
  });
});

test.describe('stock-in quantity rules @stock @items', () => {
  for (const quantity of [0, -5, 1_000_000]) {
    test(`a stock-in of ${quantity} is refused and changes nothing`, async ({ api }) => {
      const extra = new StockExtraApi(api.client);
      const item = await api.items.create({ startingQuantity: 10 });

      const response = await extra.stockInRaw(item.id, quantity);
      expect(response.status()).toBe(400);
      expect(await api.items.balance(item.id)).toBe(10);
      expect((await extra.movementRows(item.id)).filter((row) => row.movementType === 'AddStock')).toHaveLength(1);
    });
  }

  test('a small fractional stock-in is accepted and added to the balance', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 10 });

    expect((await extra.stockInRaw(item.id, 0.5)).ok()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(10.5);
  });
});

test.describe('stock adjustments @stock @items', () => {
  test('a counted quantity writes an Adjustment movement with the difference and the reason', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 50 });

    const response = await extra.adjustRaw(item.id, { countedQuantity: 30, reason: 'Count correction' });
    expect(response.ok()).toBeTruthy();

    expect(await api.items.balance(item.id)).toBe(30);
    const adjustment = (await extra.movementRows(item.id)).find((row) => row.movementType === 'Adjustment');
    expect(adjustment?.quantityDelta).toBe(-20);
    expect(adjustment?.quantityBefore).toBe(50);
    expect(adjustment?.quantityAfter).toBe(30);
    expect(adjustment?.notes).toBe('Count correction');
  });

  test('a plus or minus change applies on top of the balance', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 50 });

    expect((await extra.adjustRaw(item.id, { quantityChange: 7, reason: 'Lost' })).ok()).toBeTruthy();
    expect((await extra.adjustRaw(item.id, { quantityChange: -12, reason: 'Damaged or spoiled' })).ok()).toBeTruthy();

    expect(await api.items.balance(item.id)).toBe(45);
    const deltas = (await extra.movementRows(item.id)).filter((row) => row.movementType === 'Adjustment').map((row) => row.quantityDelta);
    expect(deltas.sort((a, b) => a - b)).toEqual([-12, 7]);
  });

  test('a reason is required and must be one of the listed ones', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 50 });

    expect((await extra.adjustRaw(item.id, { countedQuantity: 40, reason: '' })).status()).toBe(400);
    const unknown = await extra.adjustRaw(item.id, { countedQuantity: 40, reason: 'Because' });
    expect(unknown.status()).toBe(400);
    expect(await textOf(unknown)).toContain('Choose one of the listed reasons');
    expect(await api.items.balance(item.id)).toBe(50);
  });

  test('the reason Other needs a note and keeps it in the movement', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 50 });

    const without = await extra.adjustRaw(item.id, { countedQuantity: 40, reason: 'Other' });
    expect(without.status()).toBe(400);
    expect(await textOf(without)).toContain('A note is required');

    const note = unique('Found a box');
    expect((await extra.adjustRaw(item.id, { countedQuantity: 40, reason: 'Other', notes: note })).ok()).toBeTruthy();
    const adjustment = (await extra.movementRows(item.id)).find((row) => row.movementType === 'Adjustment');
    expect(adjustment?.notes).toBe(`Other: ${note}`);
  });

  test('a count equal to the balance, both modes together, or neither are refused', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 50 });

    const same = await extra.adjustRaw(item.id, { countedQuantity: 50, reason: 'Count correction' });
    expect(same.status()).toBe(400);
    expect(await textOf(same)).toContain('nothing to adjust');

    expect((await extra.adjustRaw(item.id, { countedQuantity: 40, quantityChange: -10, reason: 'Lost' })).status()).toBe(400);
    expect((await extra.adjustRaw(item.id, { reason: 'Lost' })).status()).toBe(400);
    expect(await api.items.balance(item.id)).toBe(50);
  });

  test('a count of zero is allowed', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 5 });

    expect((await extra.adjustRaw(item.id, { countedQuantity: 0, reason: 'Lost' })).ok()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(0);
  });

  test('a blocking item cannot be adjusted below zero, a warn-only one can', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const blocking = await api.items.create({ startingQuantity: 5, allowNegativeStock: false });
    const warnOnly = await api.items.create({ startingQuantity: 5, allowNegativeStock: true });

    const refused = await extra.adjustRaw(blocking.id, { quantityChange: -8, reason: 'Lost' });
    expect(refused.status()).toBe(400);
    expect(await textOf(refused)).toContain('below zero');
    expect(await api.items.balance(blocking.id)).toBe(5);

    expect((await extra.adjustRaw(warnOnly.id, { quantityChange: -8, reason: 'Lost' })).ok()).toBeTruthy();
    expect(await api.items.balance(warnOnly.id)).toBe(-3);
  });

  test('a cashier and an item manager cannot adjust stock', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 5 });

    expect((await extra.adjustRaw(item.id, { quantityChange: 1, reason: 'Lost' }, 'cashier')).status()).toBe(403);
    expect((await extra.adjustRaw(item.id, { quantityChange: 1, reason: 'Lost' }, 'itemmgr')).status()).toBe(403);
  });
});

test.describe('blocking setting and alert levels @stock @items', () => {
  test('turning off "allow sales below zero" is refused while the balance is negative, and works after a count', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 5, allowNegativeStock: true });
    await extra.adjustRaw(item.id, { quantityChange: -9, reason: 'Lost' });
    expect(await api.items.balance(item.id)).toBe(-4);

    const refused = await extra.updateRaw(item.id, { allowNegativeStock: false });
    expect(refused.status()).toBe(400);
    expect(await textOf(refused)).toContain('below zero');
    expect((await api.items.get(item.id)).allowNegativeStock).toBe(true);

    await extra.adjustRaw(item.id, { countedQuantity: 6, reason: 'Count correction' });
    expect((await extra.updateRaw(item.id, { allowNegativeStock: false })).ok()).toBeTruthy();
    expect((await api.items.get(item.id)).allowNegativeStock).toBe(false);
  });

  test('creating an item whose starting stock is already under its warning level alerts', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 8, warningQuantity: 20, criticalQuantity: 3 });

    await expect.poll(async () => (await extra.alertsFor(item.id)).length).toBe(1);
    const [alert] = await extra.alertsFor(item.id);
    expect(alert.kind).toBe('StockAlert');
    expect(alert.title).toContain(item.name);
  });

  test('creating an item with no stock yet stays quiet', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 0, warningQuantity: 20, criticalQuantity: 3 });

    // Give the (absent) alert a moment to show up before asserting that it did not.
    await expect.poll(async () => (await extra.fullItem(item.id)).currentQuantity).toBe(0);
    expect(await extra.alertsFor(item.id)).toHaveLength(0);
  });

  test('an item above its levels does not alert, and raising the warning level above the balance alerts at once', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 50, warningQuantity: 20, criticalQuantity: 5 });
    expect(await extra.alertsFor(item.id)).toHaveLength(0);

    expect((await extra.updateRaw(item.id, { warningQuantity: 100 })).ok()).toBeTruthy();
    await expect.poll(async () => (await extra.alertsFor(item.id)).length).toBe(1);
  });

  test('raising the critical level above the balance alerts as critical', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 15, warningQuantity: 20, criticalQuantity: 5 });
    await expect.poll(async () => (await extra.alertsFor(item.id)).length).toBe(1);

    expect((await extra.updateRaw(item.id, { criticalQuantity: 30 })).ok()).toBeTruthy();
    await expect.poll(async () => (await extra.alertsFor(item.id)).length).toBe(2);
    const titles = (await extra.alertsFor(item.id)).map((row) => row.title);
    expect(titles.some((title) => title.startsWith('Critically low'))).toBe(true);
  });
});

test.describe('item validation @stock @items', () => {
  test('a duplicate SKU or barcode is refused on create and on update', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const sku = uniqueCode('SKU');
    const barcode = uniqueCode('BC');
    const first = await extra.createItemRaw({ sku, barcode });
    expect(first.ok()).toBeTruthy();

    const sameSku = await extra.createItemRaw({ sku });
    expect(sameSku.status()).toBe(400);
    expect(await textOf(sameSku)).toContain('SKU already exists');

    const sameBarcode = await extra.createItemRaw({ barcode });
    expect(sameBarcode.status()).toBe(400);
    expect(await textOf(sameBarcode)).toContain('barcode already exists');

    const other = await api.items.create();
    const clash = await extra.updateRaw(other.id, { sku });
    expect(clash.status()).toBe(400);
    expect(await textOf(clash)).toContain('SKU already exists');
  });

  test('an item can be saved again with its own SKU and blank SKUs may repeat', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const sku = uniqueCode('SKU');
    const created = await (await extra.createItemRaw({ sku })).json();

    expect((await extra.updateRaw(created.id, { name: unique('E2E Renamed') })).ok()).toBeTruthy();
    expect((await extra.createItemRaw({ sku: null })).ok()).toBeTruthy();
    expect((await extra.createItemRaw({ sku: '   ' })).ok()).toBeTruthy();
  });

  test('a name of 101 characters is refused with a 400', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    expect((await extra.createItemRaw({ name: 'x'.repeat(101) })).status()).toBe(400);
  });

  test('a name of exactly 100 characters is accepted', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    const name = `${unique('L')}${'y'.repeat(100)}`.slice(0, 100);
    expect(name).toHaveLength(100);
    expect((await extra.createItemRaw({ name })).ok()).toBeTruthy();
  });

  test('an empty name is refused', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    expect((await extra.createItemRaw({ name: '' })).ok()).toBe(false);
  });

  test('a negative starting quantity is refused', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    expect((await extra.createItemRaw({ startingQuantity: -1 })).status()).toBe(400);
  });

  test('a starting quantity above 999,999.999 is refused', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    expect((await extra.createItemRaw({ startingQuantity: 1_000_000 })).status()).toBe(400);
  });

  test('a negative cost or warning level is refused', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    expect((await extra.createItemRaw({ costPrice: -0.01 })).status()).toBe(400);
    expect((await extra.createItemRaw({ warningQuantity: -1 })).status()).toBe(400);
  });

  test('units per stock unit of zero is refused', async ({ api }) => {
    const extra = new StockExtraApi(api.client);
    expect((await extra.createItemRaw({ stockUnitName: 'carton', unitsPerStockUnit: 0 })).status()).toBe(400);
  });

  test('stock display unit and units per stock unit are accepted, saved and shown on the details page', async ({ api, signIn }) => {
    const extra = new StockExtraApi(api.client);
    const created = await (
      await extra.createItemRaw({ unitName: 'piece', stockUnitName: 'carton', unitsPerStockUnit: 12, startingQuantity: 24 })
    ).json();

    const saved = await extra.fullItem(created.id);
    expect(saved.stockUnitName).toBe('carton');
    expect(saved.unitsPerStockUnit).toBe(12);
    expect(saved.currentQuantity).toBe(24);

    const page = await signIn('admin');
    await page.goto(`/inventory/items/details/${created.id}`);
    await expect(page.getByText('Current Stock')).toBeVisible();
    await expect(page.getByText(/^\s*2\s*ctn\s*$/).first()).toBeVisible();
    await expect(page.getByText(/24\s*pc/).first()).toBeVisible();
  });
});
