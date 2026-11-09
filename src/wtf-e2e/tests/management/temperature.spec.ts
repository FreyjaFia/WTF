import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { AddOnType } from '@data/enums';
import { OrderEditorPage } from '@pages/order-editor.page';
import { go } from '@utils/navigation';
import { VIEWPORTS, measureOverflow, overflowProblem } from '@utils/layout';
import { unique } from '@utils/unique';

interface AddOnGroup {
  readonly type: number;
  readonly defaultAddOnId?: string | null;
  readonly options: ReadonlyArray<{ readonly id: string }>;
}

async function seedDrink(api: Api): Promise<{ drinkId: string; drinkName: string; hotId: string; icedId: string; shotId: string }> {
  const drink = await api.products.create({ name: unique('E2E Latte'), price: 120 });
  const hot = await api.products.create({ isAddOn: true, price: 0, name: unique('E2E Hot') });
  const iced = await api.products.create({ isAddOn: true, price: 10, name: unique('E2E Iced') });
  const shot = await api.products.create({ isAddOn: true, price: 15, name: unique('E2E Shot') });
  await api.products.linkAddOns(drink.id, [
    { addOnId: hot.id, addOnType: AddOnType.Temperature },
    { addOnId: iced.id, addOnType: AddOnType.Temperature },
    { addOnId: shot.id, addOnType: AddOnType.Extra },
  ]);
  return { drinkId: drink.id, drinkName: drink.name, hotId: hot.id, icedId: iced.id, shotId: shot.id };
}

async function groupsOf(api: Api, productId: string): Promise<AddOnGroup[]> {
  return api.client.json<AddOnGroup[]>('superadmin', 'GET', `products/${productId}/addons`);
}

async function setDefault(api: Api, productId: string, addOnId: string, isDefault: boolean): Promise<number> {
  const response = await api.client.call('superadmin', 'PUT', `products/${productId}/addons/${addOnId}/default`, { body: { isDefault } });
  return response.status();
}

test.describe('temperature add-on: the pre-selected option @management', () => {
  test('one option per required type can be pre-selected, and it is cleared when unlinked', async ({ api }) => {
    const seed = await seedDrink(api);

    expect(await setDefault(api, seed.drinkId, seed.hotId, true)).toBe(200);
    expect(await setDefault(api, seed.drinkId, seed.icedId, true)).toBe(200);
    let temperature = (await groupsOf(api, seed.drinkId)).find((g) => g.type === AddOnType.Temperature);
    expect(temperature?.defaultAddOnId).toBe(seed.icedId);

    expect(await setDefault(api, seed.drinkId, seed.shotId, true)).toBe(400);
    expect(await setDefault(api, seed.drinkId, seed.icedId, false)).toBe(200);
    temperature = (await groupsOf(api, seed.drinkId)).find((g) => g.type === AddOnType.Temperature);
    expect(temperature?.defaultAddOnId ?? null).toBeNull();

    await setDefault(api, seed.drinkId, seed.hotId, true);
    await api.products.linkAddOns(seed.drinkId, [{ addOnId: seed.icedId, addOnType: AddOnType.Temperature }]);
    await api.products.linkAddOns(seed.drinkId, [
      { addOnId: seed.hotId, addOnType: AddOnType.Temperature },
      { addOnId: seed.icedId, addOnType: AddOnType.Temperature },
    ]);
    temperature = (await groupsOf(api, seed.drinkId)).find((g) => g.type === AddOnType.Temperature);
    expect(temperature?.defaultAddOnId ?? null).toBeNull();
  });

  test('an order for the drink needs a temperature', async ({ api }) => {
    const seed = await seedDrink(api);

    const response = await api.orders.createRaw({ items: [{ productId: seed.drinkId, quantity: 1 }] });

    expect(response.status()).toBe(400);
  });

  for (const viewport of VIEWPORTS) {
    test(`pre-select in the product editor and at the register at ${viewport.name}`, async ({ api, signIn }) => {
      const seed = await seedDrink(api);
      const page = await signIn('admin');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await go(page, `/management/products/edit/${seed.drinkId}`);
      const preSelect = page.getByRole('button', { name: 'Pre-select', exact: true });
      await expect(preSelect).toHaveCount(2);
      await preSelect.last().click();
      await expect(page.getByRole('button', { name: 'Pre-selected', exact: true })).toHaveCount(1);
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      await page.screenshot({ path: `test-results/temperature-editor-${viewport.width}.png`, fullPage: true });
      await expect.poll(async () => (await groupsOf(api, seed.drinkId)).find((g) => g.type === AddOnType.Temperature)?.defaultAddOnId).not.toBeFalsy();

      const editor = new OrderEditorPage(page);
      await editor.open();
      await editor.search.fill(seed.drinkName);
      await editor.product(seed.drinkName).click();
      const add = page.getByRole('button', { name: 'Add to Cart', exact: true });
      await expect(add).toBeEnabled();
      await expect(page.getByText('Temperature').first()).toBeVisible();
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      await page.screenshot({ path: `test-results/temperature-selector-${viewport.width}.png` });
    });
  }
});
