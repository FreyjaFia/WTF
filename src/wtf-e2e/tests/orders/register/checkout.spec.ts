import { expect, test } from '@fixtures/index';
import { OrderEditorPage } from '@pages/order-editor.page';

test.describe('checking out at the register @orders @stock', () => {
  test('a cashier sells a drink for cash and the linked stock is taken', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 100 });
    const item = await api.items.create({ startingQuantity: 20 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 3 }]);

    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();
    await editor.addProduct(drink.name);
    await editor.payCash(100);

    await expect.poll(() => api.items.balance(item.id)).toBe(17);
    const movements = await api.items.movements(item.id);
    expect(movements.some((m) => (m.movementType ?? m.type) === 'Sale')).toBeTruthy();
  });

  test('checkout stays disabled while the cart is empty', async ({ signIn }) => {
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();
    await expect(editor.checkoutButton).toBeDisabled();
  });

  test('an item that blocks sales stops checkout when the cart needs more than is left', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 80 });
    const item = await api.items.create({ startingQuantity: 1, allowNegativeStock: false });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();
    await editor.addProduct(drink.name, 2);

    await expect(editor.stockBanner).toBeVisible();
    await expect(editor.checkoutButton).toBeDisabled();
    expect(await api.items.balance(item.id)).toBe(1);
  });

  test('a warn-only item does not stop checkout when stock is short', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 80 });
    const item = await api.items.create({ startingQuantity: 1, allowNegativeStock: true });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();
    await editor.addProduct(drink.name, 2);
    await expect(editor.checkoutButton).toBeEnabled();
  });
});
