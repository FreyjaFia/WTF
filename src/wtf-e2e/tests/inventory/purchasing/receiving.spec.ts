import { PurchasingApi, asRole } from '@api/purchasing';
import { expect, test } from '@fixtures/index';
import { ReceivingPage } from '@pages/purchasing.page';
import { unique } from '@utils/unique';

test.describe('receiving stock @inventory @receiving', () => {
  test('a delivery typed on the page adds the units and shows on the list with its total', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 10 });
    await buy.link(item.id, supplier.summary.id, { packName: 'carton', unitsPerPack: 12, packPrice: 840 });
    const invoice = unique('INV');

    const page = await signIn('admin');
    const receiving = new ReceivingPage(page);
    await receiving.open();
    await receiving.receiveButton.click();
    await receiving.chooseSupplier(supplier.summary.name);
    await receiving.chooseItem(0, item.name);
    await expect(page.locator('#rl-units-0')).toHaveValue('12');
    await expect(page.locator('#rl-price-0')).toHaveValue('840');
    await receiving.packs(0).fill('2');
    await expect(receiving.line(0).getByTestId('line-summary')).toContainText('Adds 24');
    await expect(receiving.total).toContainText('1,680.00');
    await page.locator('#rc-invoice').fill(invoice);
    await receiving.saveButton.click();

    await expect(receiving.row(invoice)).toContainText('1,680.00');
    await expect(receiving.row(invoice)).toContainText(supplier.summary.name);
    expect((await buy.item(item.id)).currentQuantity).toBe(34);
  });

  test('the last price is kept, and the average cost blends what was on hand with what arrived', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 100, costPrice: 5 });

    // 100 on hand at 5.00, then 100 arrive at 15.00 a unit (one pack of 100 at 1,500).
    await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1, unitsPerPack: 100, packPrice: 1500 }]);

    const after = await buy.item(item.id);
    expect(after.currentQuantity).toBe(200);
    expect(after.costPrice).toBe(15);
    expect(after.averageCost).toBe(10);
  });

  test('the invoice total is compared with the lines and a difference is flagged', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    const matching = await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 2 }], { invoiceNumber: unique('OK'), invoiceTotal: 1680 });
    const off = await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 2 }], { invoiceNumber: unique('OFF'), invoiceTotal: 1700 });
    expect(matching.summary.difference).toBe(0);
    expect(off.summary.difference).toBe(20);

    const page = await signIn('admin');
    const receiving = new ReceivingPage(page);
    await receiving.open();
    await receiving.receiveButton.click();
    await receiving.chooseSupplier(supplier.summary.name);
    await receiving.chooseItem(0, item.name);
    await receiving.packs(0).fill('2');
    await page.locator('#rc-total').fill('1700');
    await expect(receiving.difference).toContainText('20.00');
    await page.locator('#rc-total').fill('1680');
    await expect(receiving.difference).toHaveCount(0);
  });

  test('sending the same request twice adds the stock once', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 0 });
    const clientRequestId = crypto.randomUUID();

    const first = await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { clientRequestId });
    const second = await buy.receive(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { clientRequestId });

    expect(second.ok()).toBeTruthy();
    expect((await second.json()).summary.id).toBe(first.summary.id);
    expect((await buy.item(item.id)).currentQuantity).toBe(12);
  });

  test('a receipt with no lines, a zero quantity, an unknown item or a date far in the future is refused', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();

    expect((await buy.receive(supplier.summary.id, [])).status()).toBe(400);
    expect((await buy.receive(supplier.summary.id, [{ itemId: item.id, packs: 0 }])).status()).toBe(400);
    expect((await buy.receive(supplier.summary.id, [{ itemId: crypto.randomUUID(), packs: 1 }])).status()).toBe(400);
    expect((await buy.receive(crypto.randomUUID(), [{ itemId: item.id, packs: 1 }])).status()).toBe(400);
    const future = await api.client.call('superadmin', 'POST', 'stock-receipts', {
      body: { supplierId: supplier.summary.id, receivedOn: '2999-01-01', lines: [{ itemId: item.id, packs: 1, unitsPerPack: 1 }] },
    });
    expect(future.status()).toBe(400);
    expect((await buy.item(item.id)).currentQuantity).toBe(0);
  });

  test('the price paid is remembered as the new pack price, with a history entry', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    await buy.link(item.id, supplier.summary.id, { packPrice: 800 });

    await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1, packPrice: 880 }]);

    const links = await api.client.json<{ packPrice: number | null; lastChangePercent: number | null; priceHistory: { source: string; newPackPrice: number }[] }[]>(
      'superadmin', 'GET', `items/${item.id}/suppliers`,
    );
    expect(links[0].packPrice).toBe(880);
    expect(links[0].lastChangePercent).toBe(10);
    expect(links[0].priceHistory[0]).toMatchObject({ source: 'Receipt', newPackPrice: 880 });
  });

  test('a stock manager can receive but is never shown or charged a price they cannot see', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 0 });
    await buy.link(item.id, supplier.summary.id, { packPrice: 840 });

    const page = await signIn('stockmgr');
    const receiving = new ReceivingPage(page);
    await receiving.open();
    await receiving.receiveButton.click();
    await receiving.chooseSupplier(supplier.summary.name);
    await receiving.chooseItem(0, item.name);
    await expect(page.locator('#rl-price-0')).toHaveCount(0);
    await expect(page.locator('#rc-total')).toHaveCount(0);
    await receiving.packs(0).fill('1');
    await receiving.saveButton.click();
    await expect(receiving.form).toHaveCount(0);

    expect((await buy.item(item.id)).currentQuantity).toBe(12);
    const stored = await api.client.json<{ items: { packPrice: number }[] }>('superadmin', 'GET', `suppliers/${supplier.summary.id}`);
    expect(stored.items[0].packPrice).toBe(840);
  });

  test('a viewer can read receipts but not record one, and the search box filters the list', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    const invoice = unique('FIND');
    await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { invoiceNumber: invoice });
    expect((await api.client.call('viewer', 'POST', 'stock-receipts', { body: {} })).status()).toBe(403);

    const page = await signIn('viewer');
    const receiving = new ReceivingPage(page);
    await receiving.open();
    await expect(receiving.receiveButton).toHaveCount(0);
    await receiving.search.fill(invoice);
    await expect(receiving.row(invoice)).toHaveCount(1);
    await receiving.search.fill('zzz-nothing-matches');
    await expect(receiving.empty).toBeVisible();
  });

  test('the column headers sort the receipts on a wide screen and are hidden on a phone', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 0 });
    await buy.link(item.id, supplier.summary.id, { packName: 'carton', unitsPerPack: 12, packPrice: 840 });
    const small = unique('INV');
    const large = unique('INV');
    await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { invoiceNumber: small });
    await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 3 }], { invoiceNumber: large });

    const page = await signIn('admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    const receiving = new ReceivingPage(page);
    await receiving.open();
    await receiving.search.fill(supplier.summary.name);
    const columns = page.getByTestId('receipt-columns');
    await expect(columns).toBeVisible();
    for (const name of ['Receipt', 'Received', 'Items', 'Total']) {
      await expect(columns).toContainText(name);
    }

    const order = async (): Promise<string[]> => {
      const rows = await page.getByTestId('receipt-row').allTextContents();
      return rows.map((text) => (text.includes(small) ? 'small' : text.includes(large) ? 'large' : 'other'));
    };
    await expect.poll(order).toEqual(['large', 'small']);

    await page.getByRole('button', { name: 'Sort by Total' }).click();
    await expect.poll(order).toEqual(['small', 'large']);
    await page.getByRole('button', { name: 'Sort by Total' }).click();
    await expect.poll(order).toEqual(['large', 'small']);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(columns).toBeHidden();
  });
});
