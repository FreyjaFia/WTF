import { Page } from '@playwright/test';
import { ScopedKind, ScopedUser, World, closeWorld, inBranch, openWorld } from '@api/branch-scope';
import { testPassword } from '@data/env';
import { ROUTES } from '@data/routes';
import { USERNAMES } from '@data/users';
import { expect, test } from '@fixtures/index';
import { BranchSwitcherPage } from '@pages/branch-switcher.page';
import { KitchenPage } from '@pages/kitchen.page';
import { LoginPage } from '@pages/login.page';
import { OrderEditorPage } from '@pages/order-editor.page';
import { RAW_ERROR_TEXT, openAs, storedBranch } from '@utils/branch-ui';
import { go } from '@utils/navigation';

const RANDOM_BRANCH = '3b9d6a52-8e17-4c04-a1f6-5d2c7e90b384';

interface Saved {
  readonly label: string;
  readonly value: (world: World) => string;
}

const SAVED_VALUES: ReadonlyArray<Saved> = [
  { label: 'a branch they cannot use', value: (world) => world.branchB.id },
  { label: 'junk text', value: () => 'banana' },
  { label: 'a made-up id', value: () => RANDOM_BRANCH },
  { label: 'All branches', value: () => 'all' },
];

const PEOPLE: ReadonlyArray<ScopedKind> = ['cashier', 'manager'];

function userOf(world: World, kind: ScopedKind): ScopedUser {
  return kind === 'cashier' ? world.cashier : world.manager;
}

// The manager may keep All branches (it then covers only their own branches); everyone else lands in the default branch.
function expectedSaved(world: World, kind: ScopedKind, value: string): string {
  return kind === 'manager' && value === 'all' ? 'all' : world.branchA.id;
}

async function expectOnlyBranchA(page: Page, world: World, kind: ScopedKind): Promise<void> {
  await test.step('orders list', async () => {
    await go(page, ROUTES.ordersList);
    const rows = page.getByTestId('order-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('137.00');
    await expect(page.locator('body')).not.toContainText('263.00');
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);
  });

  await test.step('kitchen board', async () => {
    const kitchen = new KitchenPage(page);
    await kitchen.open();
    await expect(page.getByText(world.drinkA.name).first()).toBeVisible();
    await expect(page.getByText(world.drinkB.name)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);
  });

  await test.step('products on the till', async () => {
    const editor = new OrderEditorPage(page);
    await editor.open();
    await editor.search.fill(world.drinkB.name);
    await expect(editor.search).toHaveValue(world.drinkB.name);
    await expect(editor.product(world.drinkA.name)).toHaveCount(0);
    await expect(editor.product(world.drinkB.name)).toHaveCount(0);
    await editor.search.fill(world.drinkA.name);
    await expect(editor.product(world.drinkA.name)).toBeVisible();
  });

  if (kind !== 'manager') {
    return;
  }

  await test.step('products management', async () => {
    await go(page, ROUTES.products);
    await expect(page.getByRole('heading', { name: 'Products' }).first()).toBeVisible();
    await expect(page.locator('body')).toContainText(`Sold at ${world.branchA.name}`);
    await expect(page.locator('body')).toContainText(`Sold at ${world.branchC.name}`);
    await expect(page.locator('body')).not.toContainText(`Sold at ${world.branchB.name}`);
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);
  });

  await test.step('stock counts', async () => {
    await go(page, ROUTES.counts);
    await expect(page.getByText(`Count ${world.branchA.code}`).first()).toBeVisible();
    await expect(page.getByText(`Count ${world.branchB.code}`)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);
  });

  await test.step('Daily Close', async () => {
    await go(page, ROUTES.report('daily-close'));
    await expect(page.getByText('Gross Sales').first()).toBeVisible();
    await expect(page.locator('body')).toContainText('137.00');
    await expect(page.locator('body')).not.toContainText('263.00');
    await expect(page.locator('body')).not.toContainText(world.branchB.name);
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);
  });

  await test.step('dashboard', async () => {
    await go(page, ROUTES.dashboard);
    await expect(page.getByText('TOTAL SALES', { exact: false }).first()).toBeVisible();
    await expect(page.locator('body')).toContainText('137.00');
    await expect(page.locator('body')).not.toContainText('263.00');
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);
  });
}

test.describe('the app recovers from a wrong saved branch @branches @security', () => {
  let world: World | undefined;

  test.beforeEach(async ({ api }) => {
    world = await openWorld(api);
    for (const where of [world.branchA, world.branchB]) {
      const item = await api.items.create({ startingQuantity: 20 });
      const made = await world.scope.asOwner('POST', 'stock-counts', {
        headers: inBranch(where.id),
        body: { name: `Count ${where.code}`, isBlind: false, note: null, itemIds: [item.id] },
      });
      expect(made.ok(), await made.text()).toBeTruthy();
    }
  });

  test.afterEach(async () => {
    await closeWorld(world);
  });

  for (const kind of PEOPLE) {
    for (const saved of SAVED_VALUES) {
      test(`a ${kind} whose browser remembers ${saved.label} lands in an allowed branch and sees only its data`, async ({
        api,
        newContext,
      }) => {
        const shop = world!;
        const value = saved.value(shop);
        const page = await openAs(api, newContext, userOf(shop, kind), { storedBranch: value });

        await go(page, ROUTES.ordersList);
        await expect(page.getByTestId('order-row')).toHaveCount(1);
        await expect.poll(() => storedBranch(page)).toBe(expectedSaved(shop, kind, value));
        await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);

        const switcher = new BranchSwitcherPage(page);
        await switcher.open();
        const codes = await switcher.codes();
        const own = kind === 'cashier' ? [shop.branchA.code] : ['all', shop.branchA.code, shop.branchC.code];
        expect(codes.slice().sort()).toEqual(own.slice().sort());
        expect(codes).not.toContain(shop.branchB.code);
        await switcher.close();

        await expectOnlyBranchA(page, shop, kind);
        expect(await storedBranch(page)).toBe(expectedSaved(shop, kind, value));
      });
    }
  }

  test('a manager who switches branch sees only that branch, and the saved branch follows the choice', async ({ api, newContext }) => {
    const shop = world!;
    const page = await openAs(api, newContext, shop.manager);
    await go(page, ROUTES.ordersList);
    await expect(page.getByTestId('order-row')).toHaveCount(1);

    const switcher = new BranchSwitcherPage(page);
    await switcher.open();
    await switcher.option(shop.branchC.code).click();
    await expect.poll(() => storedBranch(page)).toBe(shop.branchC.id);
    await expect(page.getByTestId('order-row')).toHaveCount(0);
    await expect(page.getByText('No orders found')).toBeVisible();

    await switcher.open();
    await switcher.option('all').click();
    await expect.poll(() => storedBranch(page)).toBe('all');
    await expect(page.getByTestId('order-row')).toHaveCount(1);
    await expect(page.locator('body')).not.toContainText('263.00');
  });
});

test.describe('signing out and in again @branches @security', () => {
  let world: World | undefined;

  test.beforeEach(async ({ api }) => {
    world = await openWorld(api);
  });

  test.afterEach(async () => {
    await closeWorld(world);
  });

  test('another person who signs in on the same browser lands in their own branch, not the previous one', async ({ api, newContext }) => {
    const shop = world!;
    const page = await openAs(api, newContext, shop.cashier);
    await go(page, ROUTES.ordersList);
    await expect(page.getByTestId('order-row')).toHaveCount(1);
    expect(await storedBranch(page)).toBe(shop.branchA.id);

    const switcher = new BranchSwitcherPage(page);
    await switcher.logOut();

    await new LoginPage(page).signIn(shop.cashierB.username, shop.cashierB.password);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await go(page, ROUTES.ordersList);
    await expect(page.getByTestId('order-row')).toHaveCount(1);
    await expect(page.getByTestId('order-row').first()).toContainText('263.00');
    await expect(page.locator('body')).not.toContainText('137.00');
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);
    await expect.poll(() => storedBranch(page)).toBe(shop.branchB.id);

    await switcher.open();
    expect(await switcher.codes()).toEqual([shop.branchB.code]);
  });

  test("the owner who signs in after a manager starts in the owner's own default branch, not the manager's (needs fix) @pending-fixes", async ({
    api,
    newContext,
  }) => {
    const shop = world!;
    const mine = await api.client.json<{ defaultBranchId: string }>('owner', 'GET', 'branches/mine');
    expect(mine.defaultBranchId).not.toBe(shop.branchC.id);

    const page = await openAs(api, newContext, shop.manager, { storedBranch: shop.branchC.id });
    await go(page, ROUTES.ordersList);
    await expect.poll(() => storedBranch(page)).toBe(shop.branchC.id);

    await new BranchSwitcherPage(page).logOut();
    await new LoginPage(page).signIn(USERNAMES.owner, testPassword());
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await go(page, ROUTES.ordersList);
    await expect(page.getByTestId('branch-switcher-button').first()).toBeVisible();
    await expect.poll(() => storedBranch(page)).toBe(mine.defaultBranchId);
  });

  test('signing out forgets the working branch (needs fix) @pending-fixes', async ({ api, newContext }) => {
    const shop = world!;
    const page = await openAs(api, newContext, shop.manager, { storedBranch: shop.branchC.id });
    await go(page, ROUTES.ordersList);
    await expect.poll(() => storedBranch(page)).toBe(shop.branchC.id);

    await new BranchSwitcherPage(page).logOut();
    expect(await storedBranch(page)).toBeNull();
  });

  test('a closed branch is not offered and a saved closed branch is left for an open one (needs fix) @pending-fixes', async ({
    api,
    newContext,
  }) => {
    const shop = world!;
    const closing = await shop.scope.asOwner('POST', `branches/${shop.branchC.id}/close`, {
      headers: inBranch(shop.branchA.id),
      body: { moveStaffToBranchId: null },
    });
    expect(closing.ok(), await closing.text()).toBeTruthy();

    const owner = { username: USERNAMES.owner, password: testPassword() };
    const page = await openAs(api, newContext, owner, { storedBranch: shop.branchC.id });
    await go(page, ROUTES.ordersList);
    await expect(page.getByTestId('branch-switcher-button').first()).toBeVisible();
    await expect.poll(() => storedBranch(page)).not.toBe(shop.branchC.id);

    const switcher = new BranchSwitcherPage(page);
    await switcher.open();
    expect(await switcher.codes()).not.toContain(shop.branchC.code);
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);

    const board = new KitchenPage(page);
    await board.open();
    await expect(page.locator('body')).not.toContainText(RAW_ERROR_TEXT);
  });
});
