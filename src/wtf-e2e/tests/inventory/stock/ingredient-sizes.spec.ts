import { expect, test } from '@fixtures/index';

interface IngredientsEdit {
  readonly lines: readonly {
    readonly itemId: string;
    readonly sizeAmounts?: readonly { readonly sizeProductId: string; readonly quantity: number }[];
  }[];
}

test.describe('Amounts per size and the preview @stock @ingredients', () => {
  test('an admin types a size amount, saves it and the preview uses it', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const { drink, size } = await api.products.withSize(150, 30);
    await api.items.linkProducts(milk.id, [{ productId: drink.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${drink.id}`);
    await expect(page.getByTestId('size-grid')).toBeVisible();

    await page.getByTestId('size-amount').fill('300');
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/ingredients') && r.request().method() === 'PUT',
    );
    await page.getByTestId('save-ingredients').click();
    expect((await saveResponse).ok()).toBe(true);

    const saved = await api.client.json<IngredientsEdit>(
      'superadmin',
      'GET',
      `products/${drink.id}/ingredients`,
    );
    expect(saved.lines[0].sizeAmounts).toEqual([{ sizeProductId: size.id, quantity: 300 }]);

    await page.getByTestId('preview-size').selectOption({ value: size.id });
    await expect(page.getByTestId('preview-cost')).toContainText('30.00');
    await expect(page.getByTestId('preview-price')).toContainText('180.00');
    await expect(page.getByTestId('preview-line').first()).toContainText('300');
  });

  test('Fill uses the amount times the size multiplier and skips whole pieces', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const cup = await api.items.create({ unitName: 'pc', startingQuantity: 100, costPrice: 4 });
    const { drink, size } = await api.products.withSize(150, 30);
    await api.client.json('superadmin', 'PUT', `products/${size.id}/recipe-multiplier`, { multiplier: 1.5 });
    await api.items.linkProducts(milk.id, [{ productId: drink.id, quantityPerSale: 200 }]);
    await api.items.linkProducts(cup.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${drink.id}`);
    await page.getByTestId('fill-size').click();

    const cells = page.getByTestId('size-amount');
    const values = await cells.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect([...values].sort()).toEqual(['', '300']);
  });

  test('a stock manager sees the grid without any cost or preview', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'ml', startingQuantity: 5000, costPrice: 0.1 });
    const { drink } = await api.products.withSize(150, 30);
    await api.items.linkProducts(milk.id, [{ productId: drink.id, quantityPerSale: 200 }]);

    const page = await signIn('stockmgr');
    await page.goto(`/inventory/ingredients/${drink.id}`);

    await expect(page.getByTestId('size-grid')).toBeVisible();
    await expect(page.getByTestId('preview')).toHaveCount(0);
    await expect(page.getByTestId('total-cost')).toHaveCount(0);
  });
});
