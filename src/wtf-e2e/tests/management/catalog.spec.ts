import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ApiClient } from '@api/client';
import { Category } from '@data/enums';
import { unique } from '@utils/unique';
import { go } from '@utils/navigation';

interface AddOnTypeRow {
  readonly id: number;
  readonly name: string;
  readonly isRequired: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly isActive: boolean;
  readonly productCount: number;
}

interface SubCategoryRow {
  readonly id: number;
  readonly name: string;
  readonly categoryId: number | null;
  readonly isActive: boolean;
}

interface CategoryRow {
  readonly id: number;
  readonly name: string;
  readonly isActive: boolean;
  readonly subCategories: readonly SubCategoryRow[];
}

interface Setup {
  readonly categories: readonly CategoryRow[];
  readonly unassignedSubCategories: readonly SubCategoryRow[];
  readonly addOnTypes: readonly AddOnTypeRow[];
}

const CATALOG_ROUTE = '/management/setup/categories';

async function setup(api: Api): Promise<Setup> {
  return api.client.json<Setup>('admin', 'GET', 'catalog');
}

async function createType(api: Api, name: string, rules: { isRequired: boolean; minSelect: number; maxSelect: number }): Promise<number> {
  const saved = await api.client.json<{ id: number }>('admin', 'POST', 'catalog/addon-types', { name, ...rules, sortOrder: 50 });
  return saved.id;
}

test.describe('catalog setup API @management @catalog', () => {
  test('the seeded lists are there and Size and Flavor are required pick-one', async ({ api }) => {
    const result = await setup(api);

    expect(result.categories.map((c) => c.name)).toEqual(expect.arrayContaining(['Drink', 'Food', 'Dessert', 'Other']));
    const size = result.addOnTypes.find((t) => t.name === 'Size');
    expect(size).toMatchObject({ isRequired: true, minSelect: 1, maxSelect: 1 });
    expect(result.addOnTypes.find((t) => t.name === 'Sauce')).toMatchObject({ isRequired: false, maxSelect: 1 });
  });

  test('a new category and a sub-category under it are saved, renamed and switched off and on', async ({ api }) => {
    const categoryName = unique('E2E Cat');
    const category = await api.client.json<{ id: number }>('admin', 'POST', 'catalog/categories', { name: categoryName, sortOrder: 70 });
    const subName = unique('E2E Sub');
    const sub = await api.client.json<{ id: number }>('admin', 'POST', 'catalog/subcategories', { name: subName, categoryId: category.id, sortOrder: 71 });

    let result = await setup(api);
    const saved = result.categories.find((c) => c.id === category.id);
    expect(saved?.subCategories.map((s) => s.id)).toEqual([sub.id]);

    await api.client.json('admin', 'PUT', `catalog/categories/${category.id}`, { name: `${categoryName} 2`, sortOrder: 70 });
    await api.client.call('admin', 'PUT', `catalog/subcategories/${sub.id}/active`, { body: { isActive: false } });
    await api.client.call('admin', 'PUT', `catalog/categories/${category.id}/active`, { body: { isActive: false } });
    result = await setup(api);
    expect(result.categories.find((c) => c.id === category.id)).toMatchObject({ name: `${categoryName} 2`, isActive: false });

    await api.client.call('admin', 'PUT', `catalog/categories/${category.id}/active`, { body: { isActive: true } });
    expect((await setup(api)).categories.find((c) => c.id === category.id)?.isActive).toBe(true);
  });

  test('duplicate names, blank names and a missing parent category are refused', async ({ api }) => {
    const name = unique('E2E Dup');
    await api.client.json('admin', 'POST', 'catalog/categories', { name, sortOrder: 72 });

    const duplicate = await api.client.call('admin', 'POST', 'catalog/categories', { body: { name, sortOrder: 73 } });
    const blank = await api.client.call('admin', 'POST', 'catalog/categories', { body: { name: '   ', sortOrder: 73 } });
    const orphan = await api.client.call('admin', 'POST', 'catalog/subcategories', { body: { name: unique('E2E Orphan'), categoryId: 9999, sortOrder: 1 } });
    const minAboveMax = await api.client.call('admin', 'POST', 'catalog/addon-types', {
      body: { name: unique('E2E Odd'), isRequired: false, minSelect: 3, maxSelect: 2, sortOrder: 1 },
    });

    for (const [label, response] of [['duplicate', duplicate], ['blank', blank], ['orphan', orphan], ['min above max', minAboveMax]] as const) {
      expect.soft(response.status(), `${label}: ${await response.text()}`).toBe(400);
    }
  });

  test('a category still used by an active product cannot be switched off', async ({ api }) => {
    const drink = await api.products.create();
    expect(drink.isActive).toBe(true);

    const response = await api.client.call('admin', 'PUT', `catalog/categories/${Category.Drink}/active`, { body: { isActive: false } });

    expect(response.status()).toBe(400);
    expect((await setup(api)).categories.find((c) => c.id === Category.Drink)?.isActive).toBe(true);
  });

  test('Size can never be switched off', async ({ api }) => {
    const size = (await setup(api)).addOnTypes.find((t) => t.name === 'Size')!;

    const response = await api.client.call('admin', 'PUT', `catalog/addon-types/${size.id}/active`, { body: { isActive: false } });

    expect(response.status()).toBe(400);
  });

  test('only the roles that write products can change the catalog', async ({ api }) => {
    const body = { name: unique('E2E Denied'), sortOrder: 1 };
    for (const role of ['cashier', 'viewer', 'stockmgr'] as const) {
      const response = await api.client.call(role, 'POST', 'catalog/categories', { body });
      expect.soft(response.status(), role).toBe(403);
    }

    const read = await api.client.call('viewer', 'GET', 'catalog');
    expect(read.status()).toBe(200);
  });

  test('a custom required pick-one type is enforced on orders: none or two is refused, one is accepted', async ({ api }) => {
    const typeId = await createType(api, unique('E2E Temp'), { isRequired: true, minSelect: 1, maxSelect: 1 });
    const drink = await api.products.create({ price: 120 });
    const hot = await api.products.create({ isAddOn: true, price: 0 });
    const iced = await api.products.create({ isAddOn: true, price: 10 });
    await api.products.linkAddOns(drink.id, [
      { addOnId: hot.id, addOnType: typeId },
      { addOnId: iced.id, addOnType: typeId },
    ]);

    const none = await api.orders.createRaw({ items: [{ productId: drink.id, quantity: 1 }] });
    const both = await api.orders.createRaw({
      items: [{ productId: drink.id, quantity: 1, addOns: [{ productId: hot.id, quantity: 1 }, { productId: iced.id, quantity: 1 }] }],
    });
    const one = await api.orders.createRaw({
      items: [{ productId: drink.id, quantity: 1, addOns: [{ productId: iced.id, quantity: 1 }] }],
    });

    expect(none.status()).toBe(400);
    expect(await ApiClient.messageOf(none)).toContain('selection is required');
    expect(both.status()).toBe(400);
    expect(one.status(), await one.text()).toBe(201);
    const saved = await ApiClient.parse<{ totalAmount: number }>(one, 'order');
    expect(saved.totalAmount).toBe(130);
  });

  test('a type that is still linked to add-ons cannot be switched off until they are unlinked', async ({ api }) => {
    const typeId = await createType(api, unique('E2E Linked'), { isRequired: false, minSelect: 0, maxSelect: 0 });
    const drink = await api.products.create();
    const extra = await api.products.create({ isAddOn: true, price: 5 });
    await api.products.linkAddOns(drink.id, [{ addOnId: extra.id, addOnType: typeId }]);

    const refused = await api.client.call('admin', 'PUT', `catalog/addon-types/${typeId}/active`, { body: { isActive: false } });
    expect(refused.status()).toBe(400);
    expect((await setup(api)).addOnTypes.find((t) => t.id === typeId)?.productCount).toBe(1);

    await api.products.linkAddOns(drink.id, []);
    const allowed = await api.client.call('admin', 'PUT', `catalog/addon-types/${typeId}/active`, { body: { isActive: false } });
    expect(allowed.status()).toBe(204);
  });
});

test.describe('catalog setup screen @management @catalog', () => {
  test('an Admin adds an add-on type in the dialog and sees its rule', async ({ api, signIn }) => {
    const page = await signIn('admin', { landing: true });
    const name = unique('UI Temp');
    await go(page, '/management/setup/addon-types');

    await page.getByTestId('add-catalog-entry').click();
    await page.locator('#catalog-name').fill(name);
    await page.locator('#catalog-order').fill('60');
    await page.locator('input[formcontrolname="isRequired"]').check();
    await page.locator('#catalog-max').fill('1');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByTestId('catalog-list').getByText(name)).toBeVisible();
    await expect(page.getByTestId('catalog-list').locator('li', { hasText: name })).toContainText('Required · Pick one');
    const saved = (await setup(api)).addOnTypes.find((t) => t.name === name);
    expect(saved).toMatchObject({ isRequired: true, minSelect: 1, maxSelect: 1 });
  });

  test('a category with products refuses Turn Off and shows the reason', async ({ api, signIn }) => {
    await api.products.create();
    const page = await signIn('admin', { landing: true });
    await go(page, CATALOG_ROUTE);

    const row = page.getByTestId('catalog-list').locator('li', { hasText: 'Drink' }).first();
    await row.getByRole('button', { name: 'Entry actions' }).click();
    await row.getByRole('button', { name: 'Turn Off' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn Off' }).click();

    await expect(page.getByText(/still use this category/i)).toBeVisible();
  });

  test('an Admin Viewer can open the page but has no Add, Edit or Turn Off', async ({ signIn }) => {
    const page = await signIn('viewer', { landing: true });
    await go(page, CATALOG_ROUTE);

    await expect(page.getByTestId('catalog-list')).toBeVisible();
    await expect(page.getByTestId('add-catalog-entry')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Entry actions' })).toHaveCount(0);
  });

  test('a Cashier is sent away from the page', async ({ signIn }) => {
    const page = await signIn('cashier', { landing: true });
    await go(page, CATALOG_ROUTE);

    await expect(page).not.toHaveURL(new RegExp(`${CATALOG_ROUTE}$`));
  });
});
