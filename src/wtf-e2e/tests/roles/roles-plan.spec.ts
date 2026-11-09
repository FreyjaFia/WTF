import { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { PlatformApi } from '@api/platform';
import { ShopSession } from '@api/shop-session';
import { testPassword } from '@data/env';
import { LoginPage } from '@pages/login.page';
import { RoleEditorPage } from '@pages/roles.page';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { openShop, TestShop } from '@utils/tenants';
import { unique, uniqueUsername } from '@utils/unique';

interface Role {
  readonly id: number;
  readonly name: string;
  readonly permissions: ReadonlyArray<string>;
}

interface PermissionInfo {
  readonly key: string;
  readonly inPlan: boolean;
  readonly availableInPlans: ReadonlyArray<string>;
}

async function planId(platform: PlatformApi, code: string): Promise<number> {
  const plan = (await platform.plans()).find((p) => p.code === code);
  if (!plan) {
    throw new Error(`Plan ${code} is not seeded.`);
  }

  return plan.id;
}

async function status(session: ShopSession, path: string): Promise<number> {
  return (await session.call('GET', path)).status();
}

async function staffOn(request: APIRequestContext, owner: ShopSession, roleId: number): Promise<ShopSession> {
  const username = uniqueUsername();
  await owner.json('POST', 'users', { firstName: unique('Staff'), lastName: 'E2E', username, password: testPassword(), roleId });
  return ShopSession.signIn(request, username, testPassword());
}

test.describe('plans narrow what roles can do @roles @rbac @plans', () => {
  let shop: TestShop;

  test.beforeEach(async ({ request, platform }) => {
    shop = await openShop(request, platform, { planCode: 'starter' });
  });

  test('on Starter the owner holds only the permissions whose feature is in the plan, and the API says "not in your plan"', async () => {
    const held = await shop.owner.json<string[]>('GET', 'auth/permissions');

    expect(held).toContain('orders.write');
    expect(held).toContain('roles.manage');
    expect(held).toContain('reports.read');
    for (const locked of ['items.read', 'stock.write', 'suppliers.read', 'promotions.read', 'orderlinks.manage', 'reports.generate']) {
      expect(held, locked).not.toContain(locked);
    }

    const blocked = await shop.owner.call('GET', 'items');
    expect(blocked.status()).toBe(403);
    expect(await blocked.json()).toMatchObject({ message: 'This feature is not in your plan.', code: 'not_in_plan' });
    expect(await status(shop.owner, 'suppliers')).toBe(403);
    expect(await status(shop.owner, 'products')).toBe(200);
  });

  test('upgrading the shop gives the owner the features at once, without signing in again', async ({ platform }) => {
    expect(await status(shop.owner, 'items')).toBe(403);

    await platform.setSubscription(shop.id, { planId: await planId(platform, 'pro') });

    expect(await status(shop.owner, 'items')).toBe(200);
    expect(await shop.owner.json<string[]>('GET', 'auth/permissions')).toContain('stock.write');
  });

  test('a downgrade keeps the role\'s stored keys, blocks them, and an upgrade brings them back', async ({ request, platform }) => {
    await platform.setSubscription(shop.id, { planId: await planId(platform, 'pro') });
    const role = await shop.owner.json<Role>('POST', 'roles', { name: unique('Counter'), permissions: ['orders.write', 'stock.write'] });
    const staff = await staffOn(request, shop.owner, role.id);
    expect(await status(staff, 'items')).toBe(403); // the role has stock.*, not items.read
    expect(await status(staff, 'stock-counts')).not.toBe(403);

    await platform.setSubscription(shop.id, { planId: await planId(platform, 'starter') });

    const blocked = await staff.call('GET', 'stock-counts');
    expect(blocked.status()).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: 'not_in_plan' });
    expect(await staff.json<string[]>('GET', 'auth/permissions')).toEqual(expect.arrayContaining(['orders.read', 'orders.write']));
    expect(await staff.json<string[]>('GET', 'auth/permissions')).not.toContain('stock.write');
    expect((await shop.owner.json<Role>('GET', `roles/${role.id}`)).permissions).toEqual(expect.arrayContaining(['stock.read', 'stock.write']));

    await platform.setSubscription(shop.id, { planId: await planId(platform, 'pro') });
    expect(await status(staff, 'stock-counts')).not.toBe(403);
  });

  test('the permission list marks what is outside the plan, with the plans that have it', async () => {
    const list = await shop.owner.json<PermissionInfo[]>('GET', 'roles/permissions');
    const byKey = new Map(list.map((p) => [p.key, p]));

    expect(byKey.get('orders.write')).toMatchObject({ inPlan: true });
    expect(byKey.get('stock.write')).toMatchObject({ inPlan: false, availableInPlans: ['Pro'] });
    expect(byKey.get('promotions.write')?.inPlan).toBe(false);
  });

  test('a role holding keys the plan switches off can still be edited by the owner', async () => {
    const role = await shop.owner.json<Role>('POST', 'roles', { name: unique('Mixed'), permissions: ['orders.read', 'stock.write'] });

    const updated = await shop.owner.call('PUT', `roles/${role.id}`, {
      id: role.id,
      name: role.name,
      description: 'Edited on Starter',
      permissions: ['orders.read', 'stock.write', 'expenses.read'],
    });

    expect(updated.status(), await updated.text()).toBe(200);
    expect(((await updated.json()) as Role).permissions).toEqual(expect.arrayContaining(['stock.write', 'expenses.read']));
  });

  test('another shop on Pro is not narrowed by this shop\'s plan', async ({ request, platform }) => {
    const pro = await openShop(request, platform, { planCode: 'pro' });

    expect(await status(pro.owner, 'items')).toBe(200);
    expect(await status(shop.owner, 'items')).toBe(403);
  });
});

async function openOwnerPage(page: Page, shop: TestShop): Promise<void> {
  await new LoginPage(page).signIn(shop.ownerUsername, shop.ownerPassword);
  await page.waitForURL((url) => !url.pathname.includes('login'));
}

test.describe('Roles editor greys out what the plan lacks @roles @rbac @plans @layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`locked rows show the plan name, stay unchecked-able, and nothing overflows at ${viewport.name}`, async ({ newContext, request, platform }) => {
      const shop = await openShop(request, platform, { planCode: 'starter' });
      const role = await shop.owner.json<Role>('POST', 'roles', { name: unique('Plan Role'), permissions: ['orders.read', 'stock.write'] });
      const context = await newContext({ width: viewport.width, height: viewport.height });
      const page = await context.newPage();
      const watcher = watch(page);

      await openOwnerPage(page, shop);
      const editor = new RoleEditorPage(page);
      await editor.openRole(role.id);

      const locked = page.getByTestId('plan-lock-stock.write');
      await locked.scrollIntoViewIfNeeded();
      await expect(locked).toContainText('Not in your plan. Available in Pro.');
      await expect(editor.permission('stock.write')).toBeChecked();
      await expect(editor.permission('stock.write')).toBeDisabled();
      await expect(editor.permission('orders.read')).toBeEnabled();
      await expect(page.getByTestId('plan-lock-orders.read')).toHaveCount(0);
      await expect(editor.save).toBeEnabled();

      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: horizontal overflow`).toBeNull();
      expect.soft(watcher.pageErrors, `${viewport.name}: uncaught page errors`).toEqual([]);
      expect.soft(watcher.consoleErrors, `${viewport.name}: console errors`).toEqual([]);

      await platform.setSubscription(shop.id, { planId: await planId(platform, 'pro') });
      await go(page, `/management/roles/${role.id}`);
      await page.getByTestId('area-Orders').waitFor();
      await expect(page.getByTestId('plan-lock-stock.write')).toHaveCount(0);
      await expect(editor.permission('stock.write')).toBeEnabled();
    });
  }
});
