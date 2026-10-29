import { Api } from '@api/index';
import { expect, test } from '@fixtures/index';
import { OrderStatus } from '@data/enums';
import { OrderDetailsPage } from '@pages/order-details.page';

async function soldDrink(api: Api, startingQuantity: number, quantity: number) {
  const drink = await api.products.create({ price: 110 });
  const item = await api.items.create({ startingQuantity });
  await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);
  const order = await api.orders.create({ items: [{ productId: drink.id, quantity }] });
  return { drink, item, order };
}

test.describe('order details and the refund dialog @orders @stock', () => {
  test('details list the stock movements the sale caused', async ({ api, signIn }) => {
    const { order } = await soldDrink(api, 10, 2);
    const page = await signIn('admin');
    const details = new OrderDetailsPage(page);

    await details.open(order.id);
    await expect(details.stockMovements).toContainText('Stock movements (1)');
  });

  test('refunding a line as returned to stock puts the quantity back', async ({ api, signIn }) => {
    const { drink, item, order } = await soldDrink(api, 10, 2);
    const page = await signIn('admin');
    const details = new OrderDetailsPage(page);

    await details.open(order.id);
    await details.startRefund();
    await details.stockChoice(drink.name).selectOption('returned');
    await details.refundNote.fill('Customer changed mind');
    await details.confirmRefund();

    await expect.poll(() => api.items.balance(item.id)).toBe(10);
    expect((await api.orders.get(order.id)).status).toBe(OrderStatus.Refunded);
  });

  test('refunding a line as not returned keeps the stock down', async ({ api, signIn }) => {
    const { drink, item, order } = await soldDrink(api, 10, 2);
    const page = await signIn('admin');
    const details = new OrderDetailsPage(page);

    await details.open(order.id);
    await details.startRefund();
    await details.stockChoice(drink.name).selectOption('made');
    await details.refundNote.fill('Made wrong');
    await details.confirmRefund();

    await expect.poll(async () => (await api.orders.get(order.id)).status).toBe(OrderStatus.Refunded);
    expect(await api.items.balance(item.id)).toBe(8);
  });

  test('a refund needs a note', async ({ api, signIn }) => {
    const { item, order } = await soldDrink(api, 10, 1);
    const page = await signIn('admin');
    const details = new OrderDetailsPage(page);

    await details.open(order.id);
    await details.startRefund();
    await details.confirmRefund();
    await expect(details.refundNoteError).toBeVisible();
    expect((await api.orders.get(order.id)).status).toBe(OrderStatus.Completed);
    expect(await api.items.balance(item.id)).toBe(9);
  });

  test('a viewer does not see the Refund Order button', async ({ api, signIn }) => {
    const { order } = await soldDrink(api, 10, 1);
    const page = await signIn('viewer');
    const details = new OrderDetailsPage(page);

    await details.open(order.id);
    await expect(details.refundButton).toHaveCount(0);
  });

  test('a viewer is refused by the API when trying to refund', async ({ api }) => {
    const { order } = await soldDrink(api, 10, 1);
    const response = await api.orders.voidOrder(order.id, 'nope', [], 'viewer');
    expect(response.status()).toBe(403);
    expect((await api.orders.get(order.id)).status).toBe(OrderStatus.Completed);
  });
});
