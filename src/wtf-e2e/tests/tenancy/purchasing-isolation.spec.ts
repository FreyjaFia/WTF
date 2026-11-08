import { PO_STATUS, PurchasingApi } from '@api/purchasing';
import { expect, test } from '@fixtures/index';
import { testPassword } from '@data/env';
import { openShop, TestShop } from '@utils/tenants';
import { unique } from '@utils/unique';

interface Row {
  readonly id: string;
}

interface Stocked {
  readonly shop: TestShop;
  readonly buy: PurchasingApi;
  readonly supplier: { id: string; name: string };
  readonly item: { id: string; name: string };
  readonly order: { id: string; poNumber: number };
  readonly receipt: { id: string };
}

// A shop with one supplier, one item linked to it, a par level, a sent order and a receipt against it.
async function stockedShop(shop: TestShop, supplierName: string = unique('Isolation Supplier')): Promise<Stocked> {
  const buy = new PurchasingApi(shop.owner);
  const supplier = await buy.createSupplier(supplierName);
  const item = await buy.createItem({ startingQuantity: 0 });
  await buy.link(item.id, supplier.summary.id);
  await buy.setPar(item.id, 48);
  const created = await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 4 }]);
  const order = await buy.sendOrder(created.summary.id);
  const receipt = await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { purchaseOrderId: order.summary.id });
  return {
    shop,
    buy,
    supplier: { id: supplier.summary.id, name: supplier.summary.name },
    item: { id: item.id, name: item.name },
    order: { id: order.summary.id, poNumber: order.summary.poNumber },
    receipt: { id: receipt.summary.id },
  };
}

test.describe('shops cannot see each other\'s purchasing @tenancy @isolation @purchasing', () => {
  test('suppliers, orders, receipts, par levels and the reorder list stay inside the shop', async ({ request, platform }) => {
    const a = await stockedShop(await openShop(request, platform));
    const b = await stockedShop(await openShop(request, platform));

    for (const [mine, theirs] of [[a, b], [b, a]] as const) {
      const suppliers = await mine.shop.owner.json<Row[]>('GET', 'suppliers?includeInactive=true');
      const orders = await mine.shop.owner.json<Row[]>('GET', 'purchase-orders');
      const receipts = await mine.shop.owner.json<Row[]>('GET', 'stock-receipts');
      const pars = await mine.shop.owner.json<{ itemId: string }[]>('GET', 'reorder/par-levels');
      expect(suppliers.map((s) => s.id)).toEqual([mine.supplier.id]);
      expect(orders.map((o) => o.id)).toEqual([mine.order.id]);
      expect(receipts.map((r) => r.id)).toEqual([mine.receipt.id]);
      expect(pars.map((p) => p.itemId)).toEqual([mine.item.id]);
      expect(suppliers.map((s) => s.id)).not.toContain(theirs.supplier.id);

      const reorder = await mine.shop.owner.json<{ groups: { supplierId: string | null; lines: { itemId: string }[] }[] }>('GET', 'reorder');
      const listed = reorder.groups.flatMap((g) => g.lines.map((l) => l.itemId));
      expect(listed).not.toContain(theirs.item.id);
    }
  });

  test('another shop\'s records cannot be opened, changed, sent, cancelled or deactivated by id', async ({ request, platform }) => {
    const a = await stockedShop(await openShop(request, platform));
    const b = await openShop(request, platform);
    const intruder = b.owner;

    const attempts = [
      await intruder.call('GET', `suppliers/${a.supplier.id}`),
      await intruder.call('PUT', `suppliers/${a.supplier.id}`, { name: 'Hijacked' }),
      await intruder.call('POST', `suppliers/${a.supplier.id}/deactivate`),
      await intruder.call('GET', `items/${a.item.id}/suppliers`),
      await intruder.call('GET', `purchase-orders/${a.order.id}`),
      await intruder.call('POST', `purchase-orders/${a.order.id}/cancel`),
      await intruder.call('POST', `purchase-orders/${a.order.id}/close`),
      await intruder.call('GET', `stock-receipts/${a.receipt.id}`),
    ];
    attempts.forEach((response, index) => expect(response.ok(), `attempt ${index} -> ${response.status()}`).toBeFalsy());

    const supplier = await a.buy.supplier(a.supplier.id);
    expect(supplier.summary.name).toBe(a.supplier.name);
    expect(supplier.summary.isActive).toBe(true);
    expect((await a.buy.order(a.order.id)).summary.status).toBe(PO_STATUS.partlyReceived);
  });

  test('another shop\'s supplier, item or order cannot be pulled into an order, receipt, link or par level', async ({ request, platform }) => {
    const a = await stockedShop(await openShop(request, platform));
    const b = await openShop(request, platform);
    const mine = new PurchasingApi(b.owner);
    const ownSupplier = await mine.createSupplier();
    const ownItem = await mine.createItem({ startingQuantity: 0 });

    expect((await b.owner.call('POST', 'purchase-orders', mine.orderFields(a.supplier.id, [{ itemId: ownItem.id, packs: 1 }]))).ok()).toBeFalsy();
    expect((await b.owner.call('POST', 'purchase-orders', mine.orderFields(ownSupplier.summary.id, [{ itemId: a.item.id, packs: 1 }]))).ok()).toBeFalsy();
    expect((await mine.receive(a.supplier.id, [{ itemId: ownItem.id, packs: 1 }])).ok()).toBeFalsy();
    expect((await mine.receive(ownSupplier.summary.id, [{ itemId: a.item.id, packs: 1 }])).ok()).toBeFalsy();
    expect((await mine.receive(ownSupplier.summary.id, [{ itemId: ownItem.id, packs: 1 }], { purchaseOrderId: a.order.id })).ok()).toBeFalsy();
    expect((await b.owner.call('PUT', `items/${a.item.id}/suppliers/${ownSupplier.summary.id}`, { packName: 'box', unitsPerPack: 1, packPrice: 1, isPreferred: false })).ok()).toBeFalsy();
    expect((await b.owner.call('PUT', `items/${ownItem.id}/suppliers/${a.supplier.id}`, { packName: 'box', unitsPerPack: 1, packPrice: 1, isPreferred: false })).ok()).toBeFalsy();
    expect((await mine.setPar(a.item.id, 1)).ok()).toBeFalsy();
    expect((await b.owner.call('POST', 'purchase-orders/from-reorder', { supplierId: a.supplier.id })).ok()).toBeFalsy();

    // Nothing leaked into either shop.
    expect(await a.buy.parLevel(a.item.id)).toBe(48);
    expect((await a.buy.item(a.item.id)).currentQuantity).toBe(12);
    expect((await a.buy.order(a.order.id)).lines[0].packsReceived).toBe(1);
    expect((await mine.item(ownItem.id)).currentQuantity).toBe(0);
    expect(await b.owner.json<Row[]>('GET', 'stock-receipts')).toHaveLength(0);
    expect(await b.owner.json<Row[]>('GET', 'purchase-orders')).toHaveLength(0);
  });

  test('two shops may use the same supplier name, and each numbers its own orders from 1', async ({ request, platform }) => {
    const shared = unique('Metro Dairy');
    const a = await stockedShop(await openShop(request, platform), shared);
    const b = await stockedShop(await openShop(request, platform), shared);

    expect(a.supplier.id).not.toBe(b.supplier.id);
    expect(a.order.poNumber).toBe(1);
    expect(b.order.poNumber).toBe(1);

    // The name is still unique inside one shop.
    expect((await a.shop.owner.call('POST', 'suppliers', { name: shared })).status()).toBe(400);
    const second = await a.buy.createOrder(a.supplier.id, [{ itemId: a.item.id, packs: 1 }]);
    expect(second.summary.poNumber).toBe(2);
    const otherShopNext = await b.buy.createOrder(b.supplier.id, [{ itemId: b.item.id, packs: 1 }]);
    expect(otherShopNext.summary.poNumber).toBe(2);
  });

  test('receiving in one shop never changes the stock or cost of the other', async ({ request, platform }) => {
    const a = await stockedShop(await openShop(request, platform));
    const b = await stockedShop(await openShop(request, platform));
    const beforeB = await b.buy.item(b.item.id);

    await a.buy.receiveOk(a.supplier.id, [{ itemId: a.item.id, packs: 5, packPrice: 1200 }]);

    const afterB = await b.buy.item(b.item.id);
    expect(afterB.currentQuantity).toBe(beforeB.currentQuantity);
    expect(afterB.costPrice).toBe(beforeB.costPrice);
    expect((await a.buy.item(a.item.id)).currentQuantity).toBe(12 + 60);
    expect(await b.shop.owner.json<Row[]>('GET', 'stock-receipts')).toHaveLength(1);
  });
});

test.describe('purchasing follows the shop\'s lifecycle @tenancy @purchasing @lifecycle', () => {
  const PURCHASING_CALLS: ReadonlyArray<readonly ['GET' | 'POST' | 'PUT', string]> = [
    ['GET', 'suppliers'],
    ['GET', 'purchase-orders'],
    ['GET', 'stock-receipts'],
    ['GET', 'reorder'],
    ['GET', 'reorder/par-levels'],
  ];

  test('a suspended shop cannot read or write suppliers, orders, receipts or the reorder list, and a resume restores them', async ({ request, platform }) => {
    const shop = await stockedShop(await openShop(request, platform));
    await platform.setStatus(shop.shop.id, 'suspend', 'Unpaid');

    for (const [method, path] of PURCHASING_CALLS) {
      expect((await shop.shop.owner.call(method, path)).status(), `${method} ${path}`).toBe(403);
    }

    expect((await shop.shop.owner.call('POST', 'suppliers', { name: unique('While suspended') })).status()).toBe(403);
    expect((await shop.buy.receive(shop.supplier.id, [{ itemId: shop.item.id, packs: 1 }])).status()).toBe(403);
    expect((await shop.buy.orderAction(shop.order.id, 'close')).status()).toBe(403);

    await platform.setStatus(shop.shop.id, 'resume');

    expect((await shop.buy.order(shop.order.id)).summary.status).toBe(PO_STATUS.partlyReceived);
    expect((await shop.buy.item(shop.item.id)).currentQuantity).toBe(12);
    expect((await shop.buy.receive(shop.supplier.id, [{ itemId: shop.item.id, packs: 1 }], { purchaseOrderId: shop.order.id })).ok()).toBeTruthy();
  });

  test('a deleted shop takes its suppliers, orders and receipts with it, and another shop keeps its own', async ({ request, platform }) => {
    const gone = await stockedShop(await openShop(request, platform));
    const kept = await stockedShop(await openShop(request, platform));

    await platform.setStatus(gone.shop.id, 'cancel', 'Closing');
    const deleted = await platform.call('POST', `tenants/${gone.shop.id}/delete`, { slug: gone.shop.slug, adminPassword: testPassword() });
    expect(deleted.ok(), await deleted.text()).toBeTruthy();

    for (const [method, path] of PURCHASING_CALLS) {
      expect((await gone.shop.owner.call(method, path)).ok(), `${method} ${path} with a deleted shop's token`).toBeFalsy();
    }

    expect((await kept.buy.order(kept.order.id)).summary.status).toBe(PO_STATUS.partlyReceived);
    expect((await kept.shop.owner.json<Row[]>('GET', 'suppliers')).map((s) => s.id)).toEqual([kept.supplier.id]);
    expect(await kept.shop.owner.json<Row[]>('GET', 'stock-receipts')).toHaveLength(1);
  });

  test('a cancelled shop is refused purchasing calls the same way', async ({ request, platform }) => {
    const shop = await stockedShop(await openShop(request, platform));
    await platform.setStatus(shop.shop.id, 'cancel', 'Closed');

    for (const [method, path] of PURCHASING_CALLS) {
      expect((await shop.shop.owner.call(method, path)).ok(), `${method} ${path}`).toBeFalsy();
    }
  });
});
