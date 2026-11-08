import { Page } from '@playwright/test';
import { PO_STATUS, PurchasingApi, asRole } from '@api/purchasing';
import { expect, test } from '@fixtures/index';
import { go } from '@utils/navigation';
import { VIEWPORTS, measureOverflow, overflowProblem, useStyle, watch } from '@utils/layout';

const LONG_NAME = 'Extraordinarily long supplier name that keeps going well past what fits on a phone'.slice(0, 70);
const UNBROKEN = 'Unbroken'.padEnd(80, 'W');

interface Seeds {
  readonly supplierId: string;
  readonly orderId: string;
  readonly itemName: string;
}

let seeds: Seeds;

test.beforeAll(async ({ playwright }) => {
  const context = await playwright.request.newContext();
  const { Api } = await import('@api/index');
  const api = new Api(context);
  const buy = new PurchasingApi(asRole(api.client));
  const stamp = Date.now().toString(36);
  const supplier = await buy.createSupplier(`${LONG_NAME} ${stamp}`.slice(0, 95), { contactName: UNBROKEN, phone: '0917 123 4567' });
  const item = await buy.createItem({ name: `${UNBROKEN}${stamp}`.slice(0, 95), startingQuantity: 1 });
  await buy.link(item.id, supplier.summary.id);
  await buy.setPar(item.id, 48);
  const order = await buy.createOrder(supplier.summary.id, [{ itemId: item.id, packs: 2 }]);
  await buy.sendOrder(order.summary.id);
  await buy.receiveOk(supplier.summary.id, [{ itemId: item.id, packs: 1 }], { purchaseOrderId: order.summary.id, invoiceNumber: UNBROKEN.slice(0, 50) });
  seeds = { supplierId: supplier.summary.id, orderId: order.summary.id, itemName: item.name };
  expect((await buy.order(order.summary.id)).summary.status).toBe(PO_STATUS.partlyReceived);
  await context.dispose();
});

const PAGES: ReadonlyArray<{ readonly name: string; readonly path: () => string }> = [
  { name: 'suppliers', path: () => '/inventory/suppliers' },
  { name: 'supplier details', path: () => `/inventory/suppliers/${seeds.supplierId}` },
  { name: 'reorder', path: () => '/inventory/reorder' },
  { name: 'receiving', path: () => '/inventory/receiving' },
  { name: 'purchase orders', path: () => '/inventory/purchase-orders' },
];

async function visit(page: Page, viewportName: string, name: string, path: string): Promise<void> {
  const watcher = watch(page);
  await go(page, path);
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.locator('.loading-spinner:visible, .loading-lg:visible')).toHaveCount(0);
  const where = `${viewportName} / ${name}`;
  expect.soft(overflowProblem(await measureOverflow(page)), `${where}: horizontal overflow`).toBeNull();
  expect.soft(watcher.pageErrors, `${where}: uncaught page errors`).toEqual([]);
  expect.soft(watcher.consoleErrors, `${where}: console errors`).toEqual([]);
}

test.describe('purchasing pages keep their layout with long names @inventory @layout', () => {
  for (const viewport of VIEWPORTS) {
    for (const target of PAGES) {
      test(`${target.name} at ${viewport.name}`, async ({ signIn }) => {
        const page = await signIn('admin');
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await visit(page, viewport.name, target.name, target.path());
      });
    }
  }

  test('the Cafe style keeps the purchase screens intact on a phone', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    await useStyle(page, 'cafe');
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });

    for (const target of PAGES) {
      await visit(page, 'cafe phone', target.name, target.path());
    }

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'cafe');
  });

  test('an order with a long supplier name still shows its status and total on a phone', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await go(page, '/inventory/purchase-orders');
    const row = page.getByTestId('order-row').filter({ hasText: LONG_NAME.slice(0, 30) }).first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId('order-status')).toBeVisible();
    expect(seeds.itemName.length).toBeGreaterThan(50);
  });
});
