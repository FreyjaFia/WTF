import { expect, test } from '@fixtures/index';
import { CoveragePage } from '@pages/stock-pages-extra.page';

interface IngredientsRow {
  readonly productId: string;
  readonly name: string;
  readonly ingredientCount: number;
  readonly cost: number | null;
  readonly margin: number | null;
}

interface IngredientsResult {
  readonly showsCosts: boolean;
  readonly products: readonly IngredientsRow[];
}

test.describe('Ingredients & Cost page @stock @ingredients', () => {
  test('the list shows the ingredient count, cost and margin of a product', async ({ api }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const result = await api.client.json<IngredientsResult>('superadmin', 'GET', 'products/ingredients');
    const row = result.products.find((p) => p.productId === latte.id);

    expect(result.showsCosts).toBe(true);
    expect(row?.ingredientCount).toBe(1);
    expect(row?.cost).toBe(20);
    expect(row?.margin).toBe(130);
  });

  test('a stock manager gets the counts but no costs', async ({ api }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const result = await api.client.json<IngredientsResult>('stockmgr', 'GET', 'products/ingredients');
    const row = result.products.find((p) => p.productId === latte.id);

    expect(result.showsCosts).toBe(false);
    expect(row?.ingredientCount).toBe(1);
    expect(row?.cost).toBeNull();
    expect(row?.margin).toBeNull();
  });

  test('a cashier is refused', async ({ api }) => {
    expect((await api.client.call('cashier', 'GET', 'products/ingredients')).status()).toBe(403);
  });

  test('the page shows the cost and margin line for an admin', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    const ingredients = new CoveragePage(page);
    await ingredients.open();
    await ingredients.showAll.click();
    await ingredients.search.fill(latte.name);

    await expect(ingredients.row(latte.name)).toContainText('1 ingredient');
    await expect(ingredients.row(latte.name)).toContainText('Cost ₱20.00');
    await expect(ingredients.row(latte.name)).toContainText('Margin ₱130.00');
  });

  test('the page shows no cost to a stock manager', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const page = await signIn('stockmgr');
    const ingredients = new CoveragePage(page);
    await ingredients.open();
    await ingredients.showAll.click();
    await ingredients.search.fill(latte.name);

    await expect(ingredients.row(latte.name)).toContainText('1 ingredient');
    await expect(ingredients.row(latte.name)).not.toContainText('Cost');
  });
});
