import { expect, test } from '@fixtures/index';
import { VIEWPORTS, measureOverflow, overflowProblem, useStyle } from '@utils/layout';

test.describe('Price guidance in the ingredient editor @stock @ingredients', () => {
  test('it suggests the price for the wanted margin and follows the cost live', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${latte.id}`);
    await expect(page.getByTestId('total-cost')).toContainText('20.00');

    await expect(page.getByTestId('target-margin')).toHaveValue('70');
    await expect(page.getByTestId('suggested-price')).toContainText('66.67');
    await expect(page.getByTestId('price-gap')).toContainText('already reaches');

    await page.getByTestId('target-margin').fill('90');
    await expect(page.getByTestId('suggested-price')).toContainText('200.00');
    await expect(page.getByTestId('price-gap')).toContainText('50.00');
    await expect(page.getByTestId('price-gap')).toContainText('too low');

    await page.getByTestId('line-amount').fill('100');
    await expect(page.getByTestId('suggested-price')).toContainText('100.00');
    await expect(page.getByTestId('price-gap')).toContainText('already reaches');
  });

  test('the wanted margin is remembered on this device', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${latte.id}`);
    await page.getByTestId('target-margin').fill('60');
    await page.reload();

    await expect(page.getByTestId('target-margin')).toHaveValue('60');
    await expect(page.getByTestId('suggested-price')).toContainText('50.00');
  });

  test('a product with no ingredients has no guidance', async ({ api, signIn }) => {
    const latte = await api.products.create({ price: 150 });

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${latte.id}`);
    await expect(page.getByTestId('ingredients-empty')).toBeVisible();

    await expect(page.getByTestId('price-guidance')).toHaveCount(0);
  });

  test('the admin viewer sees it, the stock and item managers see no costs at all', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const viewer = await signIn('viewer');
    await viewer.goto(`/inventory/ingredients/${latte.id}`);
    await expect(viewer.getByTestId('suggested-price')).toContainText('66.67');

    const itemManager = await signIn('itemmgr');
    await itemManager.goto(`/inventory/ingredients/${latte.id}`);
    await expect(itemManager.getByTestId('ingredient-line')).toHaveCount(1);
    await expect(itemManager.getByTestId('price-guidance')).toHaveCount(0);
    await expect(itemManager.getByTestId('cost-summary')).toHaveCount(0);
  });

  for (const viewport of VIEWPORTS) {
    for (const style of ['light', 'cafe'] as const) {
      test(`the guidance fits the screen at ${viewport.name} in the ${style} style`, async ({ api, signIn }) => {
        const milk = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.1 });
        const latte = await api.products.create({ price: 150 });
        await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

        const page = await signIn('admin');
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/inventory');
        await useStyle(page, style);
        await page.goto(`/inventory/ingredients/${latte.id}`);
        await page.getByTestId('target-margin').fill('90');

        await expect(page.getByTestId('price-gap')).toBeVisible();
        expect(overflowProblem(await measureOverflow(page))).toBeNull();
      });
    }
  }
});
