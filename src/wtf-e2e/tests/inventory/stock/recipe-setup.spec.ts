import { expect, test } from '@fixtures/index';
import { unique } from '@utils/unique';

interface IngredientsEdit {
  readonly lines: readonly { readonly itemId: string; readonly replacesItemId: string | null }[];
}

test.describe('Recipe setup screens @stock @ingredients', () => {
  test('the API refuses a unit that is not in the list, and accepts it by its full name', async ({ api }) => {
    const refused = await api.client.call('superadmin', 'POST', 'items', {
      body: { name: unique('E2E Unit'), unitName: 'ml', sku: null, startingQuantity: 1, costPrice: 1, allowNegativeStock: true },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain('Unit must be one of');

    const item = await api.items.create({ unitName: 'milliliter' });
    const saved = await api.client.json<{ unitName: string }>('superadmin', 'GET', `items/${item.id}`);
    expect(saved.unitName).toBe('milliliter');
  });

  test('an item created with a listed unit shows its base unit filled in the editor', async ({ api, signIn }) => {
    const item = await api.items.create({ unitName: 'milliliter' });

    const page = await signIn('admin');
    await page.goto(`/inventory/items/edit/${item.id}`);

    await expect(page.getByText('Base Unit').first()).toBeVisible();
    await expect(page.locator('select[formcontrolname="unitName"]')).toHaveValue('milliliter');
  });

  test('an add-on can be set to replace another item from the Manage Links dialog', async ({ api, signIn }) => {
    const dairy = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.1 });
    const oat = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.2 });
    const { drink, size: oatAddOn } = await api.products.withSize(150, 30);
    await api.items.linkProducts(dairy.id, [{ productId: drink.id, quantityPerSale: 200 }]);
    await api.items.linkProducts(oat.id, [{ productId: oatAddOn.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/items/edit/${oat.id}`);
    await page.getByRole('button', { name: 'Manage Links' }).click();

    const dialog = page.locator('#product-item-links-modal');
    await dialog.getByTestId('replaces-select').click();
    await page.getByTestId('replaces-select-option').filter({ hasText: dairy.name }).click();
    await expect(dialog.getByTestId('replaces-select')).toContainText(dairy.name);

    const saveResponse = page.waitForResponse((r) => r.url().includes('/product-links') && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save Links' }).click();
    expect((await saveResponse).ok()).toBe(true);

    const saved = await api.client.json<IngredientsEdit>('superadmin', 'GET', `products/${oatAddOn.id}/ingredients`);
    expect(saved.lines.find((line) => line.itemId === oat.id)?.replacesItemId).toBe(dairy.id);
  });

  test('cancelling Manage Links keeps both lists filled until the dialog has closed', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/items/edit/${milk.id}`);
    await page.getByRole('button', { name: 'Manage Links' }).click();

    const dialog = page.locator('#product-item-links-modal');
    await expect(dialog.getByTestId('allowance-input')).toHaveCount(1);

    // Sample the linked rows on every frame while the dialog fades out; it must never show an empty list first.
    const lowestCount = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const element = document.querySelector('#product-item-links-modal') as HTMLDialogElement;
          let lowest = Number.MAX_SAFE_INTEGER;
          const started = performance.now();
          const sample = (): void => {
            if (element.open) {
              lowest = Math.min(lowest, element.querySelectorAll('[data-testid="allowance-input"]').length);
            }

            if (!element.open && performance.now() - started > 100) {
              resolve(lowest);
              return;
            }

            if (performance.now() - started > 3000) {
              resolve(lowest);
              return;
            }

            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    expect(await lowestCount).toBeGreaterThanOrEqual(1);
    await expect(dialog).not.toBeVisible();
  });

  test('the product editor lists the add-on links above Track inventory', async ({ api, signIn }) => {
    const { drink } = await api.products.withSize(150, 30);

    const page = await signIn('admin');
    await page.goto(`/management/products/edit/${drink.id}`);

    const addOns = page.getByText('Associated Add-ons');
    const tracking = page.getByText('Track inventory', { exact: true });
    await expect(addOns).toBeVisible();
    await expect(tracking).toBeVisible();

    const addOnsBox = await addOns.boundingBox();
    const trackingBox = await tracking.boundingBox();
    expect(addOnsBox!.y).toBeLessThan(trackingBox!.y);
  });

  test('the ingredient editor has no size multiplier controls, and the product editor no multiplier box', async ({ api, signIn }) => {
    const milk = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.1 });
    const { drink } = await api.products.withSize(150, 30);
    await api.items.linkProducts(milk.id, [{ productId: drink.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${drink.id}`);
    await expect(page.getByTestId('size-grid')).toBeVisible();
    await expect(page.getByText('Bigger sizes use more')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fill' })).toHaveCount(0);

    await page.goto(`/management/products/edit/${drink.id}`);
    await expect(page.getByText('Track inventory', { exact: true })).toBeVisible();
    await expect(page.getByText('Size multiplier')).toHaveCount(0);
  });

  test('a size amount of 0 saves, and the preview leaves that ingredient out for the size', async ({ api, signIn }) => {
    const cup = await api.items.create({ unitName: 'piece', startingQuantity: 100, costPrice: 5 });
    const milk = await api.items.create({ unitName: 'milliliter', startingQuantity: 5000, costPrice: 0.1 });
    const { drink, size } = await api.products.withSize(150, 30);
    await api.items.linkProducts(cup.id, [{ productId: drink.id, quantityPerSale: 1 }]);
    await api.items.linkProducts(milk.id, [{ productId: drink.id, quantityPerSale: 200 }]);

    const page = await signIn('admin');
    await page.goto(`/inventory/ingredients/${drink.id}`);
    await expect(page.getByTestId('size-grid')).toBeVisible();

    const amounts = page.getByTestId('size-amount');
    await expect(amounts).toHaveCount(2);
    const cupBox = page.getByTestId('size-grid').locator('tr', { hasText: cup.name }).getByTestId('size-amount');
    await cupBox.fill('0');

    const saveResponse = page.waitForResponse((r) => r.url().includes('/ingredients') && r.request().method() === 'PUT');
    await page.getByTestId('save-ingredients').click();
    expect((await saveResponse).ok()).toBe(true);

    await page.getByTestId('preview-option').filter({ hasText: size.name }).click();
    await expect(page.getByTestId('preview-line').filter({ hasText: cup.name })).toHaveCount(0);
    await expect(page.getByTestId('preview-line').filter({ hasText: milk.name })).toHaveCount(1);
  });
});
