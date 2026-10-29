import { Api } from '@api/index';
import { expect, test } from '@fixtures/index';
import { OrderStatus } from '@data/enums';
import { ROUTES } from '@data/routes';
import { OrderListPage } from '@pages/order-list.page';

async function waitingOrder(api: Api, price: number = 120) {
  const product = await api.products.create({ price });
  const { link } = await api.customers.withLink();
  const order = await api.shop.submit(link.token, [{ productId: product.id, quantity: 1 }], price);
  return { product, link, order };
}

test.describe('ordering through a customer link @orders @customer-link', () => {
  test('staff accept an order waiting for approval', async ({ api, signIn }) => {
    const { order } = await waitingOrder(api);
    const page = await signIn('cashier');
    const list = new OrderListPage(page);

    await list.open();
    await list.expandAwaiting();
    await expect(list.awaiting(order.orderNumber)).toBeVisible();
    await list.accept(order.orderNumber);

    await expect.poll(async () => (await api.orders.get(order.id)).status).toBe(OrderStatus.Pending);
    await expect(list.awaiting(order.orderNumber)).toHaveCount(0);
  });

  test('staff reject an order with a reason the customer can see', async ({ api, signIn }) => {
    const { link, order } = await waitingOrder(api);
    const page = await signIn('admin');
    const list = new OrderListPage(page);

    await list.open();
    await list.expandAwaiting();
    await list.reject(order.orderNumber, 'We are closed today');

    await expect.poll(async () => (await api.orders.get(order.id)).status).toBe(OrderStatus.Cancelled);
    const mine = await api.client.call(null, 'GET', `public/order-links/${link.token}/orders/${order.id}`);
    expect(await mine.text()).toContain('We are closed today');
  });

  test('a waiting order takes no stock until it is completed', async ({ api }) => {
    const product = await api.products.create({ price: 90 });
    const item = await api.items.create({ startingQuantity: 10 });
    await api.items.linkProducts(item.id, [{ productId: product.id, quantityPerSale: 1 }]);
    const { link } = await api.customers.withLink();

    await api.shop.submit(link.token, [{ productId: product.id, quantity: 2 }], 180);
    expect(await api.items.balance(item.id)).toBe(10);
  });

  test('the customer page opens from the link', async ({ api, newContext }) => {
    const { link } = await waitingOrder(api);
    const page = await (await newContext()).newPage();
    await page.goto(ROUTES.shop(link.token));
    await expect(page.getByText('Ordering as').first()).toBeVisible();
  });

  test('a revoked link no longer opens the menu', async ({ api, newContext }) => {
    const { customer, link } = await api.customers.withLink();
    await api.customers.revokeLink(customer.id, link.id);
    const page = await (await newContext()).newPage();
    await page.goto(ROUTES.shop(link.token));
    await expect(page.getByText('Ordering as')).toHaveCount(0);
    expect((await api.shop.catalog(link.token)).status()).toBe(404);
  });

  test('a viewer cannot answer a waiting order', async ({ api }) => {
    const { order } = await waitingOrder(api);
    const response = await api.client.call('viewer', 'POST', `orders/${order.id}/approve`);
    expect(response.status()).toBe(403);
  });
});
