import { PO_STATUS, PurchasingApi, asRole } from '@api/purchasing';
import { expect, test } from '@fixtures/index';
import { OrdersPage, ReceivingPage, SuggestedOrdersPage, chooseOption } from '@pages/purchasing.page';

test.describe('purchase orders @inventory @purchase-orders', () => {
  test('an order drafted from the reorder list is sent, partly received on the Receiving page, then closed', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const milk = await buy.createItem({ startingQuantity: 10 });
    const syrup = await buy.createItem({ startingQuantity: 1 });
    await buy.link(milk.id, supplier.summary.id, { packName: 'carton', unitsPerPack: 12, packPrice: 840 });
    await buy.link(syrup.id, supplier.summary.id, { packName: 'case', unitsPerPack: 6, packPrice: 1200 });
    await buy.setPar(milk.id, 48);
    await buy.setPar(syrup.id, 12);

    const page = await signIn('admin');
    const reorder = new SuggestedOrdersPage(page);
    await reorder.open();
    await reorder.group(supplier.summary.name).getByTestId('create-order').click();

    const orders = new OrdersPage(page);
    await expect(orders.heading).toBeVisible();
    await expect(page).toHaveURL(/inventory\/purchase-orders/);
    const draft = (await api.client.json<{ id: string; poNumber: number; supplierId: string; status: number }[]>('superadmin', 'GET', `purchase-orders?supplierId=${supplier.summary.id}`))[0];
    expect(draft.status).toBe(PO_STATUS.draft);
    await expect(orders.status(draft.poNumber)).toHaveText('Draft');
    // 4 cartons at 840 and 2 cases at 1,200.
    await expect(orders.row(draft.poNumber)).toContainText('5,760.00');

    await orders.expand(draft.poNumber);
    await orders.row(draft.poNumber).getByTestId('send-order').click();
    await orders.confirmWith('Cancel');
    expect((await buy.order(draft.id)).summary.status).toBe(PO_STATUS.draft);
    await orders.row(draft.poNumber).getByTestId('send-order').click();
    await orders.confirmWith('Mark as sent');
    await expect(orders.status(draft.poNumber)).toHaveText('Sent');

    // A sent order counts as on order, so the items are no longer suggested.
    expect(await buy.reorderLine(milk.id)).toBeNull();
    expect(await buy.reorderLine(syrup.id)).toBeNull();

    const receiving = new ReceivingPage(page);
    await receiving.open();
    await receiving.receiveButton.click();
    await receiving.chooseSupplier(supplier.summary.name);
    await receiving.chooseOrder(`PO-${draft.poNumber}`);
    await expect(receiving.packs(0)).toHaveValue('4');
    await expect(receiving.packs(1)).toHaveValue('2');
    await receiving.packs(0).fill('3');
    await receiving.saveButton.click();
    await expect(receiving.row(`PO-${draft.poNumber}`)).toBeVisible();

    await orders.open();
    await expect(orders.status(draft.poNumber)).toHaveText('Partly received');
    const partly = await buy.order(draft.id);
    expect(partly.lines.find((l) => l.itemId === milk.id)?.packsReceived).toBe(3);
    expect((await buy.item(milk.id)).currentQuantity).toBe(46);
    // 46 on hand plus the carton still on the way is above par (48), so it is not suggested yet.
    expect(await buy.reorderLine(milk.id)).toBeNull();

    await orders.expand(draft.poNumber);
    await orders.row(draft.poNumber).getByTestId('close-order').click();
    await orders.confirmWith('Close order');
    await expect(orders.status(draft.poNumber)).toHaveText('Received');
    // Closed with a shortfall: the missing carton no longer counts as on order, so milk (46 of 48) is suggested again.
    const again = await buy.reorderLine(milk.id);
    expect(again?.line).toMatchObject({ onHand: 46, onOrder: 0, suggestedPacks: 1 });
  });

  test('receiving everything that was ordered completes the order', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 0 });
    const order = await buy.sendOrder((await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 2 }])).summary.id);

    await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { purchaseOrderId: order.summary.id });
    expect((await buy.order(order.summary.id)).summary.status).toBe(PO_STATUS.partlyReceived);
    const receipt = await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { purchaseOrderId: order.summary.id });

    expect(receipt.summary.purchaseOrderNumber).toBe(order.summary.poNumber);
    const done = await buy.order(order.summary.id);
    expect(done.summary.status).toBe(PO_STATUS.received);
    expect(done.lines[0].packsReceived).toBe(2);
    // A finished order accepts no more receipts.
    expect((await buy.receive(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { purchaseOrderId: order.summary.id })).status()).toBe(400);
  });

  test('a draft can be written and edited on the page, a sent order cannot be edited', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const milk = await buy.createItem();
    const syrup = await buy.createItem();
    await buy.link(milk.id, supplier.summary.id, { packName: 'carton', unitsPerPack: 12, packPrice: 840 });

    const page = await signIn('admin');
    const orders = new OrdersPage(page);
    await orders.open();
    await orders.newButton.click();
    await chooseOption(page, 'po-supplier', supplier.summary.name);
    await chooseOption(page, 'ol-item-0', milk.name);
    await expect(page.locator('#ol-units-0')).toHaveValue('12');
    await page.locator('#ol-packs-0').fill('3');
    await expect(page.getByTestId('order-total')).toContainText('2,520.00');
    await orders.saveButton.click();
    await expect(orders.form).toHaveCount(0);

    const drafts = await api.client.json<{ id: string; poNumber: number }[]>('superadmin', 'GET', `purchase-orders?supplierId=${supplier.summary.id}`);
    expect(drafts).toHaveLength(1);
    const { id, poNumber } = drafts[0];
    await orders.expand(poNumber);
    await orders.row(poNumber).getByTestId('edit-order').click();
    await page.locator('#ol-packs-0').fill('5');
    await page.getByTestId('add-line').click();
    await chooseOption(page, 'ol-item-1', syrup.name);
    await page.locator('#ol-packs-1').fill('1');
    await page.locator('#ol-units-1').fill('6');
    await orders.saveButton.click();
    await expect(orders.form).toHaveCount(0);
    expect((await buy.order(id)).lines.map((l) => l.packsOrdered).sort()).toEqual([1, 5]);

    await buy.sendOrder(id);
    const edit = await api.client.call('superadmin', 'PUT', `purchase-orders/${id}`, {
      body: buy.orderFields(supplier.summary.id, [{ itemId: milk.id, packs: 9 }]),
    });
    expect(edit.status()).toBe(400);
    await orders.open();
    await orders.expand(poNumber);
    await expect(orders.row(poNumber).getByTestId('edit-order')).toHaveCount(0);
    await expect(orders.row(poNumber).getByTestId('send-order')).toHaveCount(0);
  });

  test('order numbers count up within the shop and each order shows in the list', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    const first = await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 1 }]);
    const second = await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 1 }]);

    // Other tests create orders in the same shop at the same time, so the next number is higher, not always +1.
    expect(second.summary.poNumber).toBeGreaterThan(first.summary.poNumber);
    const listed = await api.client.json<{ id: string }[]>('superadmin', 'GET', `purchase-orders?supplierId=${supplier.summary.id}`);
    expect(listed.map((o) => o.id).sort()).toEqual([first.summary.id, second.summary.id].sort());
    const onlyDrafts = await api.client.json<{ id: string }[]>('superadmin', 'GET', `purchase-orders?supplierId=${supplier.summary.id}&status=${PO_STATUS.sent}`);
    expect(onlyDrafts).toHaveLength(0);
  });

  test('a cancelled order stops counting as on order, and cannot be cancelled or sent again', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 0 });
    await buy.link(item.id, supplier.summary.id);
    await buy.setPar(item.id, 24);
    const order = await buy.sendOrder((await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 2 }])).summary.id);
    expect(await buy.reorderLine(item.id)).toBeNull();

    const page = await signIn('admin');
    const orders = new OrdersPage(page);
    await orders.open();
    await orders.expand(order.summary.poNumber);
    await orders.row(order.summary.poNumber).getByTestId('cancel-order').click();
    await orders.confirmWith('Cancel order');
    await expect(orders.status(order.summary.poNumber)).toHaveText('Cancelled');

    expect((await buy.reorderLine(item.id))?.line.suggestedUnits).toBe(24);
    expect((await buy.orderAction(order.summary.id, 'cancel')).status()).toBe(400);
    expect((await buy.orderAction(order.summary.id, 'send')).status()).toBe(400);
    expect((await buy.receive(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { purchaseOrderId: order.summary.id })).status()).toBe(400);
  });

  test('an order with received goods cannot be cancelled, only closed', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    const order = await buy.sendOrder((await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 3 }])).summary.id);
    await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { purchaseOrderId: order.summary.id });

    expect((await buy.orderAction(order.summary.id, 'cancel')).status()).toBe(400);
    expect((await buy.orderAction(order.summary.id, 'close')).ok()).toBeTruthy();
    expect((await buy.order(order.summary.id)).summary.status).toBe(PO_STATUS.received);
  });

  test('a receipt must match the order: a draft, another supplier or an item not on it is refused', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const other = await buy.createSupplier();
    const milk = await buy.createItem({ startingQuantity: 0 });
    const syrup = await buy.createItem({ startingQuantity: 0 });
    const draft = await buy.createOrder(supplier.summary.id, [{ itemId: milk.id, packs: 2 }]);

    expect((await buy.receive(supplier.summary.id, [{ itemId: milk.id, packs: 1 }], { purchaseOrderId: draft.summary.id })).status()).toBe(400);
    const sent = await buy.sendOrder(draft.summary.id);
    expect((await buy.receive(other.summary.id, [{ itemId: milk.id, packs: 1 }], { purchaseOrderId: sent.summary.id })).status()).toBe(400);
    expect((await buy.receive(supplier.summary.id, [{ itemId: syrup.id, packs: 1 }], { purchaseOrderId: sent.summary.id })).status()).toBe(400);
    expect((await buy.receive(supplier.summary.id, [{ itemId: milk.id, packs: 1 }], { purchaseOrderId: crypto.randomUUID() })).status()).toBe(400);
    expect((await buy.item(milk.id)).currentQuantity).toBe(0);
    expect((await buy.item(syrup.id)).currentQuantity).toBe(0);
  });

  test('an order needs a supplier, at least one line, no repeated item and a positive quantity', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    const post = (fields: Record<string, unknown>) => api.client.call('superadmin', 'POST', 'purchase-orders', { body: fields });

    expect((await post(buy.orderFields(supplier.summary.id, []))).status()).toBe(400);
    expect((await post(buy.orderFields(supplier.summary.id, [{ itemId: item.id, packs: 1 }, { itemId: item.id, packs: 2 }]))).status()).toBe(400);
    expect((await post(buy.orderFields(supplier.summary.id, [{ itemId: item.id, packs: 0 }]))).status()).toBe(400);
    expect((await post(buy.orderFields(supplier.summary.id, [{ itemId: item.id, packs: -2 }]))).status()).toBe(400);
    expect((await post(buy.orderFields(crypto.randomUUID(), [{ itemId: item.id, packs: 1 }]))).status()).toBe(400);
    expect((await post(buy.orderFields(supplier.summary.id, [{ itemId: crypto.randomUUID(), packs: 1 }]))).status()).toBe(400);
    expect((await api.client.call('superadmin', 'GET', `purchase-orders/${crypto.randomUUID()}`)).status()).toBe(404);
  });

  test('"create from reorder" fails for an unknown supplier or when nothing is needed', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();

    const unknown = await api.client.call('superadmin', 'POST', 'purchase-orders/from-reorder', { body: { supplierId: crypto.randomUUID() } });
    expect(unknown.status()).toBe(400);
    const nothing = await api.client.call('superadmin', 'POST', 'purchase-orders/from-reorder', { body: { supplierId: supplier.summary.id } });
    expect(nothing.status()).toBe(400);
  });

  test('search and status filters narrow the list, and a stock manager sees no prices', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    const draft = await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 1 }]);
    const sent = await buy.sendOrder((await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 1 }])).summary.id);

    const asStockManager = await api.client.json<{ summary: { total: number | null }; lines: { packPrice: number | null; lineTotal: number | null }[] }>(
      'stockmgr', 'GET', `purchase-orders/${draft.summary.id}`,
    );
    expect(asStockManager.summary.total).toBeNull();
    expect(asStockManager.lines[0].packPrice).toBeNull();

    const page = await signIn('stockmgr');
    const orders = new OrdersPage(page);
    await orders.open();
    await orders.search.fill(supplier.summary.name);
    await expect(orders.row(draft.summary.poNumber)).toBeVisible();
    await expect(orders.row(draft.summary.poNumber)).not.toContainText('840');
    await orders.filterByStatus('Sent');
    await expect(orders.row(sent.summary.poNumber)).toBeVisible();
    await expect(orders.row(draft.summary.poNumber)).toHaveCount(0);
    await orders.search.fill('zzz-no-match');
    await expect(orders.empty).toBeVisible();
  });

  test('a viewer can read orders but not change them', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    const draft = await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 1 }]);

    expect((await api.client.call('viewer', 'GET', `purchase-orders/${draft.summary.id}`)).ok()).toBeTruthy();
    expect((await api.client.call('viewer', 'POST', `purchase-orders/${draft.summary.id}/send`)).status()).toBe(403);
    expect((await api.client.call('cashier', 'GET', 'purchase-orders')).status()).toBe(403);

    const page = await signIn('viewer');
    const orders = new OrdersPage(page);
    await orders.open();
    await expect(orders.newButton).toHaveCount(0);
    await orders.expand(draft.summary.poNumber);
    await expect(orders.row(draft.summary.poNumber).getByTestId('send-order')).toHaveCount(0);
  });

  test('the column headers sort the list on a wide screen and are hidden on a phone', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    const small = await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 1 }]);
    const large = await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 5 }]);

    const page = await signIn('admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    const orders = new OrdersPage(page);
    await orders.open();
    await orders.search.fill(supplier.summary.name);
    const columns = page.getByTestId('order-columns');
    await expect(columns).toBeVisible();
    await expect(columns).toContainText('Order');
    await expect(columns).toContainText('Expected');
    await expect(columns).toContainText('Status');
    await expect(columns).toContainText('Total');

    const numbers = async (): Promise<string[]> => (await page.getByTestId('order-row').locator('p.font-semibold').allTextContents()).map((t) => t.trim().split(' ')[0]);
    await expect.poll(numbers).toEqual([`PO-${large.summary.poNumber}`, `PO-${small.summary.poNumber}`]);

    await page.getByRole('button', { name: 'Sort by Total' }).click();
    await expect.poll(numbers).toEqual([`PO-${small.summary.poNumber}`, `PO-${large.summary.poNumber}`]);
    await page.getByRole('button', { name: 'Sort by Total' }).click();
    await expect.poll(numbers).toEqual([`PO-${large.summary.poNumber}`, `PO-${small.summary.poNumber}`]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(columns).toBeHidden();
  });
});
