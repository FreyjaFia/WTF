import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { GROUPS, STAFF_ROLES, isIn } from '@data/role-groups';
import { Role } from '@data/users';
import { today } from '@utils/dates';

type Group = ReadonlyArray<Role>;

const RANGE: string = `fromDate=${today()}&toDate=${today()}`;
const RANDOM_ID: string = '3f2b8c1e-5a6d-4e7f-9b0a-1c2d3e4f5a6b';

interface ReadCase {
  readonly path: string;
  readonly allowed: Group | 'everyone';
}

const READS: ReadonlyArray<ReadCase> = [
  { path: 'users', allowed: GROUPS.usersRead },
  { path: 'customers', allowed: GROUPS.customersReadApi },
  { path: 'products', allowed: GROUPS.productsReadApi },
  { path: 'items', allowed: GROUPS.itemsRead },
  { path: 'items/attention', allowed: GROUPS.stockMovementsRead },
  { path: 'items/coverage', allowed: GROUPS.itemsRead },
  { path: 'stock-waste', allowed: GROUPS.stockMovementsRead },
  { path: 'stock-waste/pending-count', allowed: GROUPS.stockWasteReview },
  { path: 'waste-reasons', allowed: GROUPS.wasteReasonsRead },
  { path: 'orders', allowed: GROUPS.ordersRead },
  { path: 'orders/paged?page=1&pageSize=5', allowed: GROUPS.ordersRead },
  { path: `reports/daily-sales?${RANGE}`, allowed: GROUPS.reportsRead },
  { path: `reports/waste?${RANGE}`, allowed: GROUPS.reportsRead },
  { path: 'dashboard', allowed: GROUPS.dashboardRead },
  { path: 'audit-logs', allowed: GROUPS.auditRead },
  { path: 'schema-script-history', allowed: GROUPS.schemaScriptHistoryRead },
  { path: 'management/promotions/fixed-bundles', allowed: GROUPS.promotionsRead },
  { path: 'management/promotions/mix-match', allowed: GROUPS.promotionsRead },
  { path: 'management/promotions/discounted-products', allowed: GROUPS.promotionsRead },
  { path: 'notifications', allowed: 'everyone' },
  { path: 'notifications/counts', allowed: 'everyone' },
  { path: 'pos/stock-limits', allowed: GROUPS.ordersWrite },
  { path: 'pos/waste-items', allowed: GROUPS.stockWasteWrite },
  { path: 'pos/promotions/bundles', allowed: GROUPS.ordersWrite },
  { path: 'sync/pos-catalog', allowed: GROUPS.productsReadApi },
  { path: 'conversations', allowed: GROUPS.ordersRead },
];

interface WriteCase {
  readonly label: string;
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: (ids: Ids) => string;
  readonly allowed: Group;
  readonly body?: (ids: Ids) => unknown;
  readonly probePath?: string;
}

interface Ids {
  readonly itemId: string;
  readonly productId: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly userId: string;
}

const WRITES: ReadonlyArray<WriteCase> = [
  { label: 'create a product', method: 'POST', path: () => 'products', allowed: GROUPS.productsWrite, body: () => ({ name: 'Nope', code: 'NOPE1', price: 5, category: 1 }) },
  { label: 'edit a product', method: 'PUT', path: (ids) => `products/${ids.productId}`, allowed: GROUPS.productsWrite, body: (ids) => ({ id: ids.productId, name: 'Nope', code: 'NOPE2', price: 5, category: 1 }) },
  { label: 'delete a product', method: 'DELETE', path: () => `products/${RANDOM_ID}`, allowed: GROUPS.productsWrite },
  { label: 'create a user', method: 'POST', path: () => 'users', allowed: GROUPS.usersWrite, body: () => ({ firstName: 'No', lastName: 'Way', username: 'noway', password: 'x', roleId: 2 }) },
  { label: 'delete a user', method: 'DELETE', path: () => `users/${RANDOM_ID}`, allowed: GROUPS.usersWrite },
  { label: 'create a customer', method: 'POST', path: () => 'customers', allowed: GROUPS.customersWrite, body: () => ({ firstName: 'No', lastName: 'Way' }) },
  { label: 'create an item', method: 'POST', path: () => 'items', allowed: GROUPS.itemsWrite, body: () => ({ name: 'Nope', unitName: 'piece' }) },
  { label: 'edit an item', method: 'PUT', path: (ids) => `items/${ids.itemId}`, allowed: GROUPS.itemsWrite, body: (ids) => ({ id: ids.itemId, name: 'Nope', unitName: 'piece' }) },
  { label: 'stock in', method: 'POST', path: (ids) => `items/${ids.itemId}/stock`, allowed: GROUPS.stockMovementsWrite, body: (ids) => ({ itemId: ids.itemId, quantity: 1 }) },
  { label: 'adjust stock', method: 'POST', path: (ids) => `items/${ids.itemId}/stock/adjust`, allowed: GROUPS.stockMovementsWrite, body: () => ({}) },
  { label: 'record waste', method: 'POST', path: (ids) => `items/${ids.itemId}/stock/waste`, allowed: GROUPS.stockWasteWrite, body: () => ({}) },
  { label: 'confirm waste', method: 'POST', path: () => `stock-waste/${RANDOM_ID}/confirm`, allowed: GROUPS.stockWasteReview, body: () => ({}) },
  { label: 'create a waste reason', method: 'POST', path: () => 'waste-reasons', allowed: GROUPS.wasteReasonsManage, body: () => ({}) },
  { label: 'void an order', method: 'PATCH', path: (ids) => `orders/${ids.orderId}/void`, allowed: GROUPS.ordersWrite, body: () => ({}) },
  { label: 'approve a held offline order', method: 'POST', path: (ids) => `orders/${ids.orderId}/review/approve`, allowed: GROUPS.ordersOverride, body: () => ({}) },
  { label: 'reject a held offline order', method: 'POST', path: (ids) => `orders/${ids.orderId}/review/reject`, allowed: GROUPS.ordersOverride, body: () => ({}) },
  { label: 'override a completed order', method: 'PUT', path: (ids) => `orders/${ids.orderId}/override`, allowed: GROUPS.ordersOverride, body: () => ({}) },
  { label: 'create a fixed bundle', method: 'POST', path: () => 'management/promotions/fixed-bundles', allowed: GROUPS.promotionsWrite, body: () => ({}) },
  { label: 'enable a customer ordering link', method: 'PUT', path: (ids) => `customers/${ids.customerId}/ordering-link-access`, allowed: GROUPS.customersWrite, body: () => ({ allow: false }) },
  { label: 'generate the monthly workbook', method: 'POST', path: () => 'reports/monthly-workbook/generate?year=2020&month=1', allowed: ['superadmin', 'admin'], probePath: 'reports/monthly-workbook/generate?year=2020&month=13' },
];

test.describe('API: who may read what @security', () => {
  for (const read of READS) {
    test(`GET ${read.path} follows its policy for every role`, async ({ api }) => {
      for (const role of STAFF_ROLES) {
        const response = await api.client.call(role, 'GET', read.path);
        const allowed = read.allowed === 'everyone' || isIn(read.allowed, role);
        if (allowed) {
          expect.soft(response.status(), `${role} on GET ${read.path}`).toBeLessThan(300);
          expect.soft(response.status(), `${role} on GET ${read.path}`).toBeGreaterThanOrEqual(200);
        } else {
          expect.soft(response.status(), `${role} on GET ${read.path}`).toBe(403);
        }
      }
    });

    test(`GET ${read.path} without a token gives 401`, async ({ api }) => {
      const response = await api.client.call(null, 'GET', read.path);
      expect(response.status()).toBe(401);
    });
  }
});

test.describe('API: who may write what @security', () => {
  let ids: Ids;
  const nowhere: Ids = { itemId: RANDOM_ID, productId: RANDOM_ID, orderId: RANDOM_ID, customerId: RANDOM_ID, userId: RANDOM_ID };

  test.beforeAll(async ({ playwright }) => {
    const context = await playwright.request.newContext();
    const seed = new Api(context);
    const item = await seed.items.create();
    const product = await seed.products.create();
    const customer = await seed.customers.create();
    const user = await seed.users.create();
    const order = await seed.orders.create({ items: [{ productId: product.id, quantity: 1 }] });
    ids = { itemId: item.id, productId: product.id, orderId: order.id, customerId: customer.id, userId: user.id };
    await context.dispose();
  });

  for (const write of WRITES) {
    test(`${write.method} ${write.label}: roles without the policy get 403, never 404 or 500 @security`, async ({ api }) => {
      for (const role of STAFF_ROLES) {
        if (isIn(write.allowed, role)) {
          continue;
        }

        const withBody = await api.client.call(role, write.method, write.path(ids), { body: write.body?.(ids) });
        expect.soft(withBody.status(), `${role} ${write.method} ${write.label} (body)`).toBe(403);
        const emptyBody = await api.client.call(role, write.method, write.path(ids), { body: {} });
        expect.soft(emptyBody.status(), `${role} ${write.method} ${write.label} (empty body)`).toBe(403);
      }
    });

    test(`${write.method} ${write.label}: allowed roles pass the policy (any answer but 401, 403 or 500) @security`, async ({ api }) => {
      for (const role of write.allowed) {
        const response = await api.client.call(role, write.method, write.probePath ?? write.path(nowhere), { body: {} });
        expect.soft([401, 403], `${role} ${write.method} ${write.label}: ${response.status()}`).not.toContain(response.status());
        expect.soft(response.status(), `${role} ${write.method} ${write.label} -> ${await response.text()}`).toBeLessThan(500);
      }
    });

    test(`${write.method} ${write.label} without a token gives 401 @security`, async ({ api }) => {
      const response = await api.client.call(null, write.method, write.path(ids), { body: write.body?.(ids) });
      expect(response.status()).toBe(401);
    });
  }

  test('the seeded records are untouched by the refused writes', async ({ api }) => {
    const item = await api.items.get(ids.itemId);
    expect(item.name).not.toBe('Nope');
    expect((await api.products.get(ids.productId)).isActive).toBe(true);
    expect((await api.orders.get(ids.orderId)).status).toBe(2);
  });
});
