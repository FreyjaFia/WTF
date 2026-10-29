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

test.describe('notifications @dashboard @notifications', () => {
  for (const role of ['superadmin', 'admin', 'viewer', 'cashier', 'stockmgr', 'itemmgr'] as ReadonlyArray<Role>) {
    test(`${role} can open the notifications page`, async ({ signIn }) => {
      const page = await signIn(role);
      await page.goto(ROUTES.notifications);
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
      await expect(page.getByTestId('notifications-summary')).toBeVisible();
    });
  }

  test('a stock alert reaches an admin and can be marked read by id', async ({ api }) => {
    const name = await lowItemName(api);

    await expect.poll(async () => (await findNotification(api, 'admin', name))?.isRead).toBe(false);
    const alert = (await findNotification(api, 'admin', name))!;

    const marked = await api.client.call('admin', 'POST', 'notifications/read', { body: { ids: [alert.id] } });
    expect(marked.ok(), await marked.text()).toBeTruthy();

    await expect.poll(async () => (await findNotification(api, 'admin', name))?.isRead).toBe(true);
  });

  test('a cashier never sees the admin stock alert', async ({ api }) => {
    const name = await lowItemName(api);
    await expect.poll(async () => (await findNotification(api, 'admin', name)) !== undefined).toBe(true);

    expect(await findNotification(api, 'cashier', name)).toBeUndefined();
  });

  test('Mark All Read on the page clears the unread alert', async ({ api, signIn }) => {
    const name = await lowItemName(api);
    await expect.poll(async () => (await findNotification(api, 'admin', name))?.isRead).toBe(false);

    const page = await signIn('admin');
    await page.goto(ROUTES.notifications);
    const markAll = page.getByTestId('mark-all-read');
    await expect(markAll).toBeEnabled();
    await markAll.click();

    await expect.poll(async () => (await findNotification(api, 'admin', name))?.isRead).toBe(true);
  });

  test('the counts endpoint answers for every signed-in role and refuses no login', async ({ api }) => {
    for (const role of ['superadmin', 'admin', 'viewer', 'cashier', 'stockmgr', 'itemmgr'] as ReadonlyArray<Role>) {
      const response = await api.client.call(role, 'GET', 'notifications/counts');
      expect(response.status(), role).toBe(200);
    }

    expect((await api.client.call(null, 'GET', 'notifications/counts')).status()).toBe(401);
  });
});
