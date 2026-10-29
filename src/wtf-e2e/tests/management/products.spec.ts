import { APIResponse } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ManagementExtraApi } from '@api/management-extra';
import { AddOnType } from '@data/enums';
import { unique, uniqueCode } from '@utils/unique';

const LONG_NAME: string = 'N'.repeat(101);

function mx(api: Api): ManagementExtraApi {
  return new ManagementExtraApi(api.client);
}

async function expectRejected(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), `${label}: ${await response.text()}`).toBe(400);
}

test.describe('products: create, validate, edit, delete, restore @management', () => {
  test('a valid product is created and shows in the default list', async ({ api }) => {
    const body = mx(api).productBody();

    const response = await mx(api).post('products', body);

    expect(response.status()).toBe(201);
    const created = await response.json();
    expect(created.isActive).toBe(true);
    const listed = await mx(api).list(`products?searchTerm=${encodeURIComponent(String(body.name))}`);
    expect(listed.map((product) => product.id)).toContain(created.id);
  });

  const BAD_PRODUCTS: ReadonlyArray<{ readonly label: string; readonly change: Record<string, unknown> }> = [
    { label: 'an empty name', change: { name: '' } },
    { label: 'a name of 101 characters', change: { name: LONG_NAME } },
    { label: 'an empty code', change: { code: '' } },
    { label: 'a code longer than 10 characters', change: { code: 'ABCDEFGHIJK' } },
    { label: 'a negative price', change: { price: -1 } },
    { label: 'a price above 999,999.99', change: { price: 1000000 } },
  ];
  for (const bad of BAD_PRODUCTS) {
    test(`${bad.label} gives 400 and creates nothing`, async ({ api }) => {
      const body = mx(api).productBody({ name: unique('BadProd'), code: uniqueCode('B'), ...bad.change });

      const response = await mx(api).post('products', body);

      await expectRejected(response, bad.label);
      const leaked = (await mx(api).list('products')).filter((product) => product.name === body.name || product.code === body.code);
      expect(leaked).toHaveLength(0);
    });
  }

  test('a duplicate product code gives 400 and only the first product keeps the code', async ({ api }) => {
    const first = await api.products.create();
    const code = ((await api.products.get(first.id)) as unknown as { code: string }).code;

    const response = await mx(api).post('products', mx(api).productBody({ code }));

    await expectRejected(response, 'duplicate code');
    const sameCode = (await mx(api).list('products')).filter((product) => product.code === code);
    expect(sameCode.map((product) => product.id)).toEqual([first.id]);
  });

  test('editing a product saves the new name and a price change writes price history', async ({ api }) => {
    const product = await api.products.create({ price: 90 });
    const current = await api.client.json<Record<string, unknown>>('superadmin', 'GET', `products/${product.id}`);
    const renamed = unique('E2E Renamed');

    const response = await mx(api).put(`products/${product.id}`, { ...current, id: product.id, name: renamed, price: 125 });

    expect(response.ok(), await response.text()).toBeTruthy();
    expect((await api.products.get(product.id)).name).toBe(renamed);
    await expect
      .poll(async () => (await mx(api).priceHistory(product.id)).map((h) => [h.oldPrice, h.newPrice]))
      .toEqual([[90, 125]]);
  });

  test('a second price change adds a second history row, newest first', async ({ api }) => {
    const product = await api.products.create({ price: 50 });
    await api.products.setPrice(product.id, 60);
    await api.products.setPrice(product.id, 75);

    const history = await mx(api).priceHistory(product.id);

    expect(history.map((h) => [h.oldPrice, h.newPrice])).toEqual([
      [60, 75],
      [50, 60],
    ]);
  });

  test('a product price of zero is refused on edit', async ({ api }) => {
    const product = await api.products.create({ price: 40 });
    const current = await api.client.json<Record<string, unknown>>('superadmin', 'GET', `products/${product.id}`);

    const response = await mx(api).put(`products/${product.id}`, { ...current, id: product.id, price: 0 });

    await expectRejected(response, 'zero price on edit');
    expect((await api.products.get(product.id)).price).toBe(40);
  });

  test('delete is a soft delete: hidden from the active list, kept as inactive, restore brings it back', async ({ api }) => {
    const product = await api.products.create();

    await api.products.remove(product.id);
    expect((await mx(api).list('products?isActive=true')).map((p) => p.id)).not.toContain(product.id);
    const inactive = await mx(api).list('products?isActive=false');
    expect(inactive.find((p) => p.id === product.id)?.isActive).toBe(false);
    expect((await api.products.get(product.id)).isActive).toBe(false);

    await api.products.restore(product.id);
    expect((await mx(api).list('products?isActive=true')).map((p) => p.id)).toContain(product.id);
    expect((await api.products.get(product.id)).isActive).toBe(true);
  });

  test('an add-on can be linked to a product and unlinked again', async ({ api }) => {
    const drink = await api.products.create();
    const addOn = await api.products.create({ isAddOn: true, price: 25 });

    await api.products.linkAddOns(drink.id, [{ addOnId: addOn.id, addOnType: AddOnType.Extra }]);
    expect(await mx(api).addOnsOf(drink.id)).toContain(addOn.id);
    const backwards = await api.client.json<unknown>('superadmin', 'GET', `products/addons/${addOn.id}/products`);
    expect(JSON.stringify(backwards)).toContain(drink.id);

    await api.products.linkAddOns(drink.id, []);
    expect(await mx(api).addOnsOf(drink.id)).not.toContain(addOn.id);
  });

  test('an add-on product is listed as an add-on and not as a main product', async ({ api }) => {
    const addOn = await api.products.create({ isAddOn: true, price: 10 });

    const addOns = await mx(api).list('products?isAddOn=true');

    expect(addOns.map((p) => p.id)).toContain(addOn.id);
    const drinks = await mx(api).list('products?isAddOn=false');
    expect(drinks.map((p) => p.id)).not.toContain(addOn.id);
  });
});
