import { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { ShopSession } from '@api/shop-session';
import { testPassword } from '@data/env';
import { ROLE_IDS } from '@data/users';
import { LoginPage } from '@pages/login.page';
import { go } from '@utils/navigation';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { ownerOf, openShop, TestShop } from '@utils/tenants';
import { unique, uniqueUsername } from '@utils/unique';

interface Role {
  readonly id: number;
  readonly name: string;
}

interface Person {
  readonly id: string;
  readonly username: string;
}

const SIDEBAR = {
  dashboard: 'app-sidebar a[href="/dashboard"]',
  editor: 'app-sidebar a[href="/orders/editor"]',
  list: 'app-sidebar a[href="/orders/list"]',
  inventory: '[data-testid="sidebar-inventory"]',
  management: '[data-testid="sidebar-management"]',
} as const;

type Entry = keyof typeof SIDEBAR;

async function addStaff(shop: TestShop, roleId: number): Promise<string> {
  const username = uniqueUsername();
  await shop.owner.json<Person>('POST', 'users', {
    firstName: unique('Staff'),
    lastName: 'E2E',
    username,
    password: testPassword(),
    roleId,
  });
  return username;
}

async function signInUi(page: Page, username: string, password: string = testPassword()): Promise<void> {
  await new LoginPage(page).signIn(username, password);
  await page.waitForURL((url) => !url.pathname.includes('login'));
}

async function visibleEntries(page: Page): Promise<Entry[]> {
  await expect(page.locator('app-sidebar')).toBeVisible();
  const found: Entry[] = [];
  for (const entry of Object.keys(SIDEBAR) as Entry[]) {
    if ((await page.locator(SIDEBAR[entry]).count()) > 0) {
      found.push(entry);
    }
  }
  return found;
}

async function waitForPermissions(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => localStorage.getItem('permissions') !== null)).toBe(true);
}

async function storedKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => (JSON.parse(localStorage.getItem('permissions') ?? '{}') as { keys?: string[] }).keys ?? []);
}

test.describe('what each role sees in the menu @roles @rbac', () => {
  let shop: TestShop;

  test.beforeEach(async ({ request, platform }) => {
    shop = await openShop(request, platform, { planCode: 'pro' });
  });

  const cases: ReadonlyArray<{ role: string; roleId: number; sees: Entry[]; hidden: Entry[] }> = [
    { role: 'Cashier', roleId: ROLE_IDS.Cashier, sees: ['editor', 'list'], hidden: ['dashboard', 'inventory'] },
    { role: 'Item Manager', roleId: ROLE_IDS.ItemManager, sees: ['inventory'], hidden: ['dashboard', 'editor', 'list'] },
    { role: 'Stock Manager', roleId: ROLE_IDS.StockManager, sees: ['inventory'], hidden: ['dashboard', 'editor', 'list'] },
    { role: 'Admin Viewer', roleId: ROLE_IDS.AdminViewer, sees: ['dashboard', 'list', 'inventory', 'management'], hidden: ['editor'] },
    { role: 'Admin', roleId: ROLE_IDS.Admin, sees: ['dashboard', 'editor', 'list', 'inventory', 'management'], hidden: [] },
  ];

  for (const row of cases) {
    test(`${row.role} sees ${row.sees.join(', ')} and not ${row.hidden.join(', ') || 'nothing hidden'}`, async ({ newContext }) => {
      const username = await addStaff(shop, row.roleId);
      const page = await (await newContext()).newPage();

      await signInUi(page, username);
      await waitForPermissions(page);
      await page.reload();
      const entries = await visibleEntries(page);

      for (const entry of row.sees) {
        expect(entries, `${row.role} should see ${entry}`).toContain(entry);
      }
      for (const entry of row.hidden) {
        expect(entries, `${row.role} should not see ${entry}`).not.toContain(entry);
      }
    });
  }

  test('the owner sees every entry', async ({ newContext }) => {
    const page = await (await newContext()).newPage();

    await signInUi(page, shop.ownerUsername, shop.ownerPassword);

    expect(await visibleEntries(page)).toEqual(['dashboard', 'editor', 'list', 'inventory', 'management']);
  });

  test('a custom role gets exactly the entries its permissions open', async ({ newContext }) => {
    const floor = await shop.owner.json<Role>('POST', 'roles', { name: unique('Floor'), permissions: ['orders.write'] });
    const books = await shop.owner.json<Role>('POST', 'roles', { name: unique('Books'), permissions: ['expenses.read'] });
    const floorPage = await (await newContext()).newPage();
    const booksPage = await (await newContext()).newPage();

    await signInUi(floorPage, await addStaff(shop, floor.id));
    await signInUi(booksPage, await addStaff(shop, books.id));

    expect(await visibleEntries(floorPage)).toEqual(['editor', 'list']);
    expect(await visibleEntries(booksPage)).toEqual(['management']);
  });
});

test.describe('a role edit reaches signed-in people without signing in again @roles @rbac', () => {
  test('the menu follows the edit after a reload, and the API follows it at once', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform, { planCode: 'pro' });
    const role = await shop.owner.json<Role>('POST', 'roles', { name: unique('Shift'), permissions: ['orders.write'] });
    const username = await addStaff(shop, role.id);
    const staff = await ShopSession.signIn(request, username, testPassword());
    const page = await (await newContext()).newPage();

    await signInUi(page, username);
    expect(await visibleEntries(page)).toEqual(['editor', 'list']);

    await shop.owner.json('PUT', `roles/${role.id}`, { id: role.id, name: role.name, description: 'E2E', permissions: ['orders.read', 'expenses.read'] });

    expect((await staff.call('POST', 'orders', {})).status()).toBe(403);
    expect((await staff.call('GET', 'expenses')).status()).toBe(200);

    await page.reload();
    await expect(page.locator(SIDEBAR.management)).toBeVisible();
    expect(await visibleEntries(page)).toEqual(['list', 'management']);
    expect(await storedKeys(page)).toEqual(expect.arrayContaining(['orders.read', 'expenses.read']));
    expect(await storedKeys(page)).not.toContain('orders.write');
  });
});

test.describe('the stored permission list works offline @roles @rbac', () => {
  test('a custom role keeps its menu when the permission list cannot be fetched', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform, { planCode: 'pro' });
    const role = await shop.owner.json<Role>('POST', 'roles', { name: unique('Counter'), permissions: ['orders.write', 'customers.write'] });
    const username = await addStaff(shop, role.id);
    const context = await newContext();
    const page = await context.newPage();

    await signInUi(page, username);
    await waitForPermissions(page);
    expect(await storedKeys(page)).toEqual(expect.arrayContaining(['orders.write', 'customers.write']));

    await context.route('**/api/auth/permissions', (route) => route.abort('internetdisconnected'));
    await page.reload();

    await expect(page.locator(SIDEBAR.editor)).toBeVisible();
    expect(await visibleEntries(page)).toEqual(['editor', 'list']);
  });

  test('the stored list is dropped when another person signs in on the same device', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform, { planCode: 'pro' });
    const role = await shop.owner.json<Role>('POST', 'roles', { name: unique('Counter'), permissions: ['orders.write'] });
    const first = await addStaff(shop, role.id);
    const second = await addStaff(shop, ROLE_IDS.ItemManager);
    const context = await newContext();
    const page = await context.newPage();

    await signInUi(page, first);
    await waitForPermissions(page);
    const owner = await page.evaluate(() => (JSON.parse(localStorage.getItem('permissions') ?? '{}') as { owner?: string }).owner);
    expect(owner).toBeTruthy();

    // The next person's token arrives while the first person's list is still stored and the server cannot be asked.
    const next = await ShopSession.signIn(request, second, testPassword());
    await context.route('**/api/auth/permissions', (route) => route.abort('internetdisconnected'));
    await page.evaluate((token) => localStorage.setItem('token', token), next.accessToken);
    await page.reload();

    await expect(page.locator(SIDEBAR.inventory)).toBeVisible();
    expect(await visibleEntries(page)).not.toContain('editor');
  });
});

async function signedInAs(context: BrowserContext, shop: TestShop, token: string, readOnly: boolean): Promise<Page> {
  await context.addInitScript(
    ({ accessToken, info }) => {
      localStorage.setItem('token', accessToken);
      localStorage.setItem('impersonation', JSON.stringify(info));
    },
    {
      accessToken: token,
      info: { expiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(), username: shop.ownerUsername, tenantName: shop.name, readOnly },
    },
  );
  const page = await context.newPage();
  await go(page, '/dashboard');
  return page;
}

test.describe('sign in as a shop user @roles @rbac @tenancy', () => {
  test('a read-only session gets the read keys of the role and nothing else; a writing session gets the whole role', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'pro' });
    const owner = await ownerOf(platform, shop);
    const full = await shop.owner.json<string[]>('GET', 'auth/permissions');

    const readOnly = ShopSession.withToken(request, owner.username, (await platform.impersonate(shop.id, owner.id, false)).accessToken);
    const writer = ShopSession.withToken(request, owner.username, (await platform.impersonate(shop.id, owner.id, true)).accessToken);
    const readKeys = await readOnly.json<string[]>('GET', 'auth/permissions');

    expect(readKeys.length).toBeGreaterThan(5);
    expect(readKeys.every((key) => key.endsWith('.read'))).toBe(true);
    expect(readKeys).toEqual(full.filter((key) => key.endsWith('.read')));
    expect([...(await writer.json<string[]>('GET', 'auth/permissions'))].sort()).toEqual([...full].sort());
  });

  test('a read-only session can look at roles but not change them, even for the owner', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'pro' });
    const owner = await ownerOf(platform, shop);
    const readOnly = ShopSession.withToken(request, owner.username, (await platform.impersonate(shop.id, owner.id, false)).accessToken);
    const writer = ShopSession.withToken(request, owner.username, (await platform.impersonate(shop.id, owner.id, true)).accessToken);

    expect((await readOnly.call('GET', 'roles')).status()).toBe(200);
    expect((await readOnly.call('POST', 'roles', { name: unique('Nope'), permissions: ['orders.read'] })).status()).toBe(403);
    expect((await writer.call('POST', 'roles', { name: unique('Fine'), permissions: ['orders.read'] })).status()).toBeLessThan(300);
  });

  test('the app hides what a read-only session cannot do, and shows everything to a session that may write', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform, { planCode: 'pro' });
    const owner = await ownerOf(platform, shop);
    const readToken = (await platform.impersonate(shop.id, owner.id, false)).accessToken;
    const writeToken = (await platform.impersonate(shop.id, owner.id, true)).accessToken;

    const readPage = await signedInAs(await newContext(), shop, readToken, true);
    await waitForPermissions(readPage);
    expect(await visibleEntries(readPage)).toEqual(['dashboard', 'list', 'inventory', 'management']);
    expect(await storedKeys(readPage)).not.toContain('orders.write');
    await go(readPage, '/orders/list');
    await expect(readPage.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
    await expect(readPage.locator('app-order-list a[href="/orders/editor"]')).toHaveCount(0);
    await go(readPage, '/management/roles');
    await expect.poll(() => new URL(readPage.url()).pathname).not.toBe('/management/roles');

    const writePage = await signedInAs(await newContext(), shop, writeToken, false);
    await waitForPermissions(writePage);
    expect(await visibleEntries(writePage)).toEqual(['dashboard', 'editor', 'list', 'inventory', 'management']);
    expect(await storedKeys(writePage)).toContain('roles.manage');
    await go(writePage, '/orders/list');
    await expect(writePage.locator('app-order-list a[href="/orders/editor"]')).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`a read-only session shows no errors and nothing overflows at ${viewport.name}`, async ({ request, platform, newContext }) => {
      const shop = await openShop(request, platform, { planCode: 'pro' });
      const owner = await ownerOf(platform, shop);
      const token = (await platform.impersonate(shop.id, owner.id, false)).accessToken;
      const context = await newContext({ width: viewport.width, height: viewport.height });
      const page = await signedInAs(context, shop, token, true);
      const watcher = watch(page);

      await waitForPermissions(page);
      await go(page, '/orders/list');
      await expect(page.getByRole('heading').first()).toBeVisible();

      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: horizontal overflow`).toBeNull();
      expect.soft(watcher.pageErrors, `${viewport.name}: uncaught page errors`).toEqual([]);
    });
  }
});
