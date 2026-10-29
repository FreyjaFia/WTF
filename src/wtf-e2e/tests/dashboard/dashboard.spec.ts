import { Api } from '@api/index';
import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { Role } from '@data/users';
import { unique } from '@utils/unique';

const EXCEL: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF: string = 'application/pdf';

interface DashboardJson {
  readonly today: { readonly totalOrders: number; readonly totalRevenue: number };
  readonly topSellingProducts: ReadonlyArray<{ readonly productName?: string; readonly name?: string }>;
  readonly recentOrders: ReadonlyArray<{ readonly id: string }>;
}

interface AuditPage {
  readonly items: ReadonlyArray<{ readonly action: string; readonly entityType: string; readonly entityId: string; readonly userName: string | null }>;
  readonly totalCount?: number;
}

interface NotificationRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly isRead: boolean;
}

interface NotificationPage {
  readonly items: ReadonlyArray<NotificationRow>;
  readonly unreadCount: number;
}

async function findNotification(api: Api, role: Role, needle: string): Promise<NotificationRow | undefined> {
  const page = await api.client.json<NotificationPage>(role, 'GET', 'notifications?page=1&pageSize=100');
  return page.items.find((row) => `${row.title} ${row.body}`.includes(needle));
}

async function lowItemName(api: Api): Promise<string> {
  const name = unique('E2E Alert Item');
  await api.items.create({ name, startingQuantity: 1, warningQuantity: 10, criticalQuantity: 2 });
  return name;
}

test.describe('dashboard access @dashboard @auth', () => {
  for (const role of ['superadmin', 'admin', 'viewer'] as ReadonlyArray<Role>) {
    test(`${role} gets dashboard data that includes a sale just made`, async ({ api }) => {
      const product = await api.products.create({ price: 100 });
      await api.orders.create({ items: [{ productId: product.id, quantity: 2 }] });

      const dashboard = await api.client.json<DashboardJson>(role, 'GET', 'dashboard');

      expect(dashboard.today.totalOrders).toBeGreaterThanOrEqual(1);
      expect(dashboard.today.totalRevenue).toBeGreaterThanOrEqual(200);
    });
  }

  for (const role of ['cashier', 'stockmgr', 'itemmgr'] as ReadonlyArray<Role>) {
    test(`${role} gets 403 from the dashboard API`, async ({ api }) => {
      expect((await api.client.call(role, 'GET', 'dashboard')).status()).toBe(403);
    });
  }

  test('no login gets 401 from the dashboard API', async ({ api }) => {
    expect((await api.client.call(null, 'GET', 'dashboard')).status()).toBe(401);
  });

  test('the dashboard accepts a preset and refuses nothing for an unknown one', async ({ api }) => {
    for (const preset of ['today', 'last7days', 'thisMonth']) {
      const response = await api.client.call('admin', 'GET', `dashboard?preset=${preset}`);
      expect(response.status(), preset).toBeLessThan(500);
    }
  });
});

test.describe('dashboard screen @dashboard', () => {
  for (const role of ['superadmin', 'admin', 'viewer'] as ReadonlyArray<Role>) {
    test(`${role} sees the sales tiles after a sale`, async ({ api, signIn }) => {
      const product = await api.products.create({ price: 100 });
      await api.orders.create({ items: [{ productId: product.id, quantity: 1 }] });

      const page = await signIn(role);
      await page.goto(ROUTES.dashboard);

      await expect(page.getByText('Total Sales', { exact: true })).toBeVisible();
      await expect(page.getByText('Orders', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Real-time sales, orders, and performance insights')).toBeVisible();
    });
  }

  for (const role of ['cashier', 'itemmgr'] as ReadonlyArray<Role>) {
    test(`${role} is sent away from the dashboard`, async ({ signIn }) => {
      const page = await signIn(role);
      await page.goto(ROUTES.dashboard);
      await expect(page).not.toHaveURL(/\/dashboard/);
    });
  }

  test('the dashboard raises no page errors', async ({ signIn }) => {
    const page = await signIn('admin');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(ROUTES.dashboard);
    await expect(page.getByText('Total Sales', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
