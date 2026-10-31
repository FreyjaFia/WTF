import { expect, test } from '@fixtures/index';

interface IngredientsEdit {
  readonly showsCosts: boolean;
  readonly suppliesCost: number | null;
  readonly totalCost: number | null;
  readonly lines: readonly { readonly itemId: string; readonly quantityPerSale: number }[];
}

test.describe('Ingredient editor page @stock @ingredients', () => {
  test('an admin adds an ingredient, sees the live cost and saves it', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${latte.id}`);
    await expect(page.getByTestId('ingredients-empty')).toBeVisible();

    await page.getByTestId('add-ingredient').selectOption({ label: milk.name });
    await page.getByTestId('line-amount').fill('200');
    await expect(page.getByTestId('total-cost')).toContainText('20.00');
    await expect(page.getByTestId('margin')).toContainText('130.00');

    await page.getByTestId('supplies-cost').fill('2');
    await expect(page.getByTestId('total-cost')).toContainText('22.00');

    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/ingredients') && r.request().method() === 'PUT',
    );
    await page.getByTestId('save-ingredients').click();
    expect((await saveResponse).ok()).toBe(true);

    const saved = await api.client.json<IngredientsEdit>(
      'superadmin',
      'GET',
      `products/${latte.id}/ingredients`,
    );
    expect(saved.lines).toHaveLength(1);
    expect(saved.lines[0].quantityPerSale).toBe(200);
    expect(saved.suppliesCost).toBe(2);
    expect(saved.totalCost).toBe(22);
  });

  test('an ingredient can be removed again and the list is saved empty', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${latte.id}`);
    await page.getByTestId('remove-line').click();
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/ingredients') && r.request().method() === 'PUT',
    );
    await page.getByTestId('save-ingredients').click();
    expect((await saveResponse).ok()).toBe(true);
    await expect(page.getByTestId('ingredients-empty')).toBeVisible();

    const saved = await api.client.json<IngredientsEdit>(
      'superadmin',
      'GET',
      `products/${latte.id}/ingredients`,
    );
    expect(saved.lines).toHaveLength(0);
  });

  test('a stock manager can edit the lines but sees no cost', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const page = await signIn('stockmgr');
    await page.goto(`/inventory/ingredients/${latte.id}`);

    await expect(page.getByTestId('ingredient-line')).toHaveCount(1);
    await expect(page.getByTestId('cost-summary')).toHaveCount(0);
    await expect(page.getByTestId('line-cost')).toHaveCount(0);
  });

  test('the API hides the costs from a stock manager', async ({ api }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const result = await api.client.json<IngredientsEdit>(
      'stockmgr',
      'GET',
      `products/${latte.id}/ingredients`,
    );

    expect(result.showsCosts).toBe(false);
    expect(result.totalCost).toBeNull();
    expect(result.suppliesCost).toBeNull();
  });

  test('a cashier is refused', async ({ api }) => {
    const latte = await api.products.create({ price: 150 });

    expect((await api.client.call('cashier', 'GET', `products/${latte.id}/ingredients`)).status()).toBe(403);
  });
});
