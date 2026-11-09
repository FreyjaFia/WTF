import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ROLE_IDS } from '@data/users';
import { RoleEditorPage, RoleListPage } from '@pages/roles.page';
import { go } from '@utils/navigation';
import { VIEWPORTS, Viewport, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { unique, uniqueStamp } from '@utils/unique';

interface Role {
  readonly id: number;
  readonly name: string;
}

async function seedRole(api: Api, name: string, permissions: ReadonlyArray<string>): Promise<Role> {
  return api.client.json<Role>('owner', 'POST', 'roles', { name, description: 'Made by the E2E tests', permissions });
}

test.describe('Roles screens @roles @rbac', () => {
  test('the list shows the built-in roles and a custom role, sorts, filters and searches', async ({ signIn, api }) => {
    const name = unique('Shift Lead');
    await seedRole(api, name, ['orders.write']);
    const page = await signIn('owner');
    const list = new RoleListPage(page);

    await list.open();

    await expect(list.row('Cashier')).toContainText('Built-in');
    await expect(list.row(name)).toContainText('Custom');

    await list.search.fill(name);
    await expect(page.locator('[data-testid^="role-row-"]')).toHaveCount(1);

    await list.search.fill('');
    await page.locator('app-filter-button button').first().click();
    await page.getByRole('checkbox', { name: 'Custom' }).check();
    await expect(list.row('Cashier')).toHaveCount(0);
    await expect(list.row(name)).toBeVisible();
  });

  test('a role is created from the editor: ticking a write permission ticks what it needs, and the summary follows', async ({ signIn }) => {
    const page = await signIn('owner');
    const editor = new RoleEditorPage(page);
    const name = unique('Bookkeeper');

    await editor.openNew();
    await editor.name.fill(name);
    await editor.permission('expenses.write').check();

    await expect(editor.permission('expenses.read')).toBeChecked();
    await expect(editor.summary).toContainText('Can open: Money');
    await expect(editor.summary).toContainText('Can change: Money');

    await editor.permission('expenses.read').uncheck();
    await expect(editor.permission('expenses.write')).not.toBeChecked();
    await editor.permission('expenses.read').check();

    await editor.save.click();

    await expect(page).toHaveURL(/\/management\/roles$/);
    await expect(new RoleListPage(page).row(name)).toContainText('1 permissions');
  });

  test('a built-in role opens read-only and can be duplicated into an editable copy', async ({ signIn }) => {
    const page = await signIn('owner');
    const editor = new RoleEditorPage(page);

    await editor.openRole(ROLE_IDS.Cashier);
    await expect(editor.permission('orders.write')).toBeChecked();
    await expect(editor.permission('orders.write')).toBeDisabled();
    await expect(editor.name).toBeDisabled();
    await expect(editor.save).toHaveCount(0);

    await editor.duplicate.click();

    await expect(page).toHaveURL(/\/management\/roles\/\d+$/);
    await expect(editor.name).toHaveValue(/^Cashier copy/);
    await expect(editor.name).toBeEnabled();
    await expect(editor.permission('orders.write')).toBeEnabled();
  });

  test('a custom role is duplicated and deleted from the list menu', async ({ signIn, api }) => {
    const name = unique('Temp Role');
    const role = await seedRole(api, name, ['orders.read']);
    const page = await signIn('owner');
    const list = new RoleListPage(page);

    await list.open();
    await list.actions(name);
    await page.getByTestId(`duplicate-role-${role.id}`).click();
    await expect(page).toHaveURL(/\/management\/roles\/\d+$/);

    await list.open();
    await list.search.fill(name);
    await list.actions(name);
    await page.getByTestId(`delete-role-${role.id}`).click();
    await list.dialog.getByRole('button', { name: /delete role/i }).click();

    await expect(list.row(`${name} copy`)).toBeVisible();
    await expect(page.getByTestId(`role-row-${role.id}`)).toHaveCount(0);
  });

  test('a role that people use cannot be deleted from the list', async ({ signIn, api }) => {
    const name = unique('In Use');
    const role = await seedRole(api, name, ['orders.read']);
    await api.client.json('owner', 'POST', 'users', {
      firstName: 'Busy', lastName: 'E2E', username: unique('busy').replace(/\s/g, '').toLowerCase(), password: 'x'.repeat(12), roleId: role.id,
    });
    const page = await signIn('owner');
    const list = new RoleListPage(page);

    await list.open();
    await list.actions(name);
    await page.getByTestId(`delete-role-${role.id}`).click();
    await expect(list.dialog).toContainText('1 user has this role');
    await list.dialog.getByRole('button', { name: /delete role/i }).click();

    await expect(page.getByText(/Move them to another role first/i).first()).toBeVisible();
    await expect(list.row(name)).toBeVisible();
  });

  test('the user form offers custom roles, with their description', async ({ signIn, api }) => {
    const name = unique('Waiter');
    await seedRole(api, name, ['orders.read']);
    const page = await signIn('owner');

    await go(page, '/management/users/new');
    const select = page.locator('#roleId');
    await select.waitFor();

    await select.selectOption({ label: name });
    await expect(page.getByText('Made by the E2E tests')).toBeVisible();
  });

  test('staff without the permission neither see the Roles entry nor can open the page', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });

    await expect(page.locator('app-sidebar a[href="/management/roles"]')).toHaveCount(0);
    await go(page, '/management/roles');
    await expect.poll(() => new URL(page.url()).pathname).not.toBe('/management/roles');
  });
});

async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('heading').or(page.getByPlaceholder(/search/i)).first()).toBeVisible();
  await expect(page.locator('.loading-spinner:visible, .loading-lg:visible')).toHaveCount(0);
}

test.describe('Roles screens on phone, tablet and desktop @roles @rbac @layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`list and editor have no sideways scroll, no errors, and the editor scrolls at ${viewport.name}`, async ({ signIn, api }) => {
      const stamp = uniqueStamp();
      const longName = `${stamp} Extraordinarily long role name that goes on`.slice(0, 49);
      const unbroken = `${stamp}Unbroken${'W'.repeat(40)}`.slice(0, 49);
      const longRole = await seedRole(api, longName, ['orders.read', 'expenses.write']);
      const unbrokenRole = await seedRole(api, unbroken, ['stock.write']);
      const page = await signIn('owner');
      const watcher = watch(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const targets: ReadonlyArray<{ readonly name: string; readonly path: string }> = [
        { name: 'list', path: '/management/roles' },
        { name: 'new role', path: '/management/roles/new' },
        { name: 'custom role', path: `/management/roles/${longRole.id}` },
        { name: 'unbroken name', path: `/management/roles/${unbrokenRole.id}` },
        { name: 'built-in role', path: `/management/roles/${ROLE_IDS.Cashier}` },
        { name: 'user form', path: '/management/users/new' },
      ];

      for (const target of targets) {
        watcher.reset();
        const where = `${viewport.name} / ${target.name}`;
        await go(page, target.path);
        await settled(page);

        expect.soft(overflowProblem(await measureOverflow(page)), `${where}: horizontal overflow`).toBeNull();
        expect.soft(watcher.pageErrors, `${where}: uncaught page errors`).toEqual([]);
        expect.soft(watcher.consoleErrors, `${where}: console errors`).toEqual([]);
      }

      await expectEditorScrolls(page, viewport, longRole.id);
    });
  }
});

async function expectEditorScrolls(page: Page, viewport: Viewport, roleId: number): Promise<void> {
  const editor = new RoleEditorPage(page);
  await editor.openRole(roleId);

  // The header with the save button stays on screen while the permission cards scroll underneath.
  await expect(editor.save).toBeVisible();
  const before = await editor.save.boundingBox();

  const last = page.getByTestId('area-System');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(editor.save).toBeVisible();
  const after = await editor.save.boundingBox();

  expect(after?.y, `${viewport.name}: the save button moved while scrolling`).toBeCloseTo(before?.y ?? -1, 0);
  expect(after!.x + after!.width, `${viewport.name}: the save button is cut off`).toBeLessThanOrEqual(viewport.width);
  const text = await page.locator('app-role-editor').innerText();
  expect(text).toContain('Can open:');
}
