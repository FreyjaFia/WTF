import { expect, test } from '@fixtures/index';

interface IngredientsEdit {
  readonly lines: readonly { readonly itemId: string; readonly quantityPerSale: number }[];
}

test.describe('Add ingredients to many products @stock @ingredients', () => {
  test('an admin adds one ingredient to two products and one that has it is skipped', async ({ api, signIn }) => {
    const cup = await api.items.create({ unitName: 'pc', startingQuantity: 100, costPrice: 4 });
    const first = await api.products.create({ price: 100 });
    const second = await api.products.create({ price: 110 });
    const third = await api.products.create({ price: 120 });
    await api.items.linkProducts(cup.id, [{ productId: third.id, quantityPerSale: 2 }]);

    const page = await signIn('admin');
    await page.goto('/inventory/ingredients');
    await page.getByTestId('add-ingredients').click();

    for (const product of [first, second, third]) {
      await page.locator('label', { hasText: product.name }).getByTestId('bulk-product').check();
    }

    await page.getByTestId('bulk-add-item').selectOption({ label: cup.name });
    await page.getByTestId('bulk-submit').click();

    await expect(page.getByTestId('bulk-result')).toContainText('Added 2');
    await expect(page.getByTestId('bulk-skipped')).toContainText(third.name);

    for (const product of [first, second]) {
      const saved = await api.client.json<IngredientsEdit>('superadmin', 'GET', `products/${product.id}/ingredients`);
      expect(saved.lines.map((l) => l.itemId)).toEqual([cup.id]);
    }

    const kept = await api.client.json<IngredientsEdit>('superadmin', 'GET', `products/${third.id}/ingredients`);
    expect(kept.lines[0].quantityPerSale).toBe(2);
  });

  test('the Add button stays off until something is picked', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto('/inventory/ingredients');
    await page.getByTestId('add-ingredients').click();

    await expect(page.getByTestId('bulk-submit')).toBeDisabled();
  });

  test('a cashier cannot open the page at all', async ({ signIn }) => {
    const page = await signIn('cashier');
    await page.goto('/inventory/ingredients');

    await expect(page.getByTestId('add-ingredients')).toHaveCount(0);
  });
});
