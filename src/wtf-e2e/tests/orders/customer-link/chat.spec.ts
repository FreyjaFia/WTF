import { Api } from '@api/index';
import { OrdersExtraApi } from '@api/orders-extra';
import { expect, test } from '@fixtures/index';
import { OrderStatus } from '@data/enums';

test.describe.configure({ timeout: 180_000 });

function extra(api: Api): OrdersExtraApi {
  return new OrdersExtraApi(api.client, api.orders);
}

async function waitingOrder(api: Api) {
  const drink = await api.products.create({ price: 100 });
  const { customer, link } = await api.customers.withLink();
  const order = await extra(api).place(link.token, { items: [{ productId: drink.id, quantity: 1 }] });
  return { drink, customer, link, order };
}

test.describe('order chat between customer and staff @orders @chat', () => {
  test('a customer message shows as unread for staff, the reply reaches the customer', async ({ api }) => {
    const { link, order } = await waitingOrder(api);

    const sent = await extra(api).publicSend(link.token, order.id, 'Is 5pm pickup ok?');
    expect(sent.status(), await sent.text()).toBe(200);

    await expect
      .poll(async () => (await extra(api).staffConversations()).items.find((item) => item.orderId === order.id)?.unreadCount ?? 0)
      .toBe(1);
    const chat = await extra(api).staffChat(order.id);
    expect(chat.messages.some((message) => message.body === 'Is 5pm pickup ok?')).toBeTruthy();

    const reply = await extra(api).staffSend(order.id, 'Yes, 5pm works.');
    expect(reply.status(), await reply.text()).toBe(200);

    const mine = await extra(api).chatOf(link.token, order.id);
    const fromStaff = mine.messages.find((message) => message.body === 'Yes, 5pm works.');
    expect(fromStaff?.sender.toLowerCase()).toContain('staff');
    expect(mine.unreadCount).toBeGreaterThanOrEqual(1);

    expect((await extra(api).publicRead(link.token, order.id)).status()).toBe(204);
    expect((await extra(api).chatOf(link.token, order.id)).unreadCount).toBe(0);
  });

  test('marking the chat read as staff clears the unread conversation', async ({ api }) => {
    const { link, order } = await waitingOrder(api);
    await extra(api).publicSend(link.token, order.id, 'Hello shop');
    await expect
      .poll(async () => (await extra(api).staffConversations()).items.find((item) => item.orderId === order.id)?.unreadCount ?? 0)
      .toBe(1);

    const read = await api.client.call('cashier', 'POST', `orders/${order.id}/messages/read`);
    expect(read.status()).toBe(204);

    await expect
      .poll(async () => (await extra(api).staffConversations()).items.find((item) => item.orderId === order.id)?.unreadCount ?? 0)
      .toBe(0);
  });

  test('empty, blank and over-long messages are refused on both sides', async ({ api }) => {
    const { link, order } = await waitingOrder(api);

    for (const body of ['', '    ']) {
      const customer = await extra(api).publicSend(link.token, order.id, body);
      expect(customer.status(), `customer ${JSON.stringify(body)}`).toBe(400);
      expect(await customer.text()).toContain('cannot be empty');
      expect((await extra(api).staffSend(order.id, body)).status(), `staff ${JSON.stringify(body)}`).toBe(400);
    }

    const tooLong = 'x'.repeat(1001);
    const customerLong = await extra(api).publicSend(link.token, order.id, tooLong);
    expect(customerLong.status()).toBe(400);
    expect(await customerLong.text()).toContain('1000 characters');
    expect((await extra(api).staffSend(order.id, tooLong)).status()).toBe(400);

    const atLimit = await extra(api).staffSend(order.id, 'y'.repeat(1000));
    expect(atLimit.status(), await atLimit.text()).toBe(200);
  });

  test('message text is stored as plain text, not changed or run as HTML', async ({ api }) => {
    const { link, order } = await waitingOrder(api);
    const text = '<img src=x onerror=alert(1)> & more';

    expect((await extra(api).publicSend(link.token, order.id, text)).status()).toBe(200);

    const chat = await extra(api).staffChat(order.id);
    expect(chat.messages.some((message) => message.body === text)).toBeTruthy();
  });

  test('the chat is open for a waiting order and an accepted one, then read-only once completed', async ({ api }) => {
    const { drink, customer, link, order } = await waitingOrder(api);
    expect((await extra(api).staffChat(order.id)).canSend).toBe(true);

    await api.orders.approve(order.id);
    expect((await extra(api).chatOf(link.token, order.id)).canSend).toBe(true);
    expect((await extra(api).publicSend(link.token, order.id, 'Still open')).status()).toBe(200);

    const done = await extra(api).complete(order.id, { items: [{ productId: drink.id, quantity: 1 }], customerId: customer.id, amountReceived: 500 });
    expect(done.status(), await done.text()).toBe(200);
    expect((await api.orders.get(order.id)).status).toBe(OrderStatus.Completed);

    const closed = await extra(api).chatOf(link.token, order.id);
    expect(closed.canSend).toBe(false);
    expect(closed.closedReason).toContain('finished');
    expect(closed.messages.some((message) => message.body === 'Still open')).toBeTruthy();

    const customerSend = await extra(api).publicSend(link.token, order.id, 'Too late');
    expect(customerSend.status()).toBe(400);
    expect(await customerSend.text()).toContain('chat is closed');
    const staffSend = await extra(api).staffSend(order.id, 'Too late');
    expect(staffSend.status()).toBe(400);
    expect(await staffSend.text()).toContain('chat is closed');
  });

  test('the chat is read-only once the order is rejected', async ({ api }) => {
    const { link, order } = await waitingOrder(api);
    await api.orders.reject(order.id, 'Closed today');

    const chat = await extra(api).chatOf(link.token, order.id);
    expect(chat.canSend).toBe(false);
    expect((await extra(api).publicSend(link.token, order.id, 'Please?')).status()).toBe(400);
    expect((await extra(api).staffSend(order.id, 'Sorry')).status()).toBe(400);
  });

  test('a viewer can read the chat but cannot reply or mark it read', async ({ api }) => {
    const { link, order } = await waitingOrder(api);
    await extra(api).publicSend(link.token, order.id, 'Hi from the customer');

    expect((await extra(api).staffSend(order.id, 'viewer reply', 'viewer')).status()).toBe(403);
    expect((await api.client.call('viewer', 'POST', `orders/${order.id}/messages/read`)).status()).toBe(403);
    const readable = await extra(api).staffChat(order.id, 'viewer');
    expect(readable.messages.some((message) => message.body === 'Hi from the customer')).toBeTruthy();
  });

  test('a customer cannot read or write the chat of another customer\'s order', async ({ api }) => {
    const { link, order } = await waitingOrder(api);
    const { link: other } = await api.customers.withLink();
    await extra(api).publicSend(link.token, order.id, 'private words');

    expect((await extra(api).publicChat(other.token, order.id)).status()).toBe(404);
    expect((await extra(api).publicSend(other.token, order.id, 'intruder')).status()).toBe(404);
    expect((await extra(api).publicRead(other.token, order.id)).status()).toBe(404);
    const chat = await extra(api).staffChat(order.id);
    expect(chat.messages.some((message) => message.body === 'intruder')).toBeFalsy();
  });

  test('an unknown token and an unknown order answer 404', async ({ api }) => {
    const { link } = await waitingOrder(api);

    expect((await extra(api).publicChat('no-such-token-e2e', '00000000-0000-4000-8000-00000000e2e4')).status()).toBe(404);
    expect((await extra(api).publicChat(link.token, '00000000-0000-4000-8000-00000000e2e5')).status()).toBe(404);
    expect((await api.client.call('cashier', 'GET', 'orders/00000000-0000-4000-8000-00000000e2e6/conversation')).status()).toBe(404);
  });

  test('a point-of-sale order has no chat', async ({ api }) => {
    const drink = await api.products.create({ price: 100 });
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }], status: OrderStatus.Pending });

    const response = await extra(api).staffSend(order.id, 'Hello?');

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('customer link');
  });

  test('the chat of a revoked link answers 404 to the customer but staff still see it', async ({ api }) => {
    const { customer, link, order } = await waitingOrder(api);
    await extra(api).publicSend(link.token, order.id, 'Before revoke');
    await api.customers.revokeLink(customer.id, link.id);

    expect((await extra(api).publicChat(link.token, order.id)).status()).toBe(404);
    expect((await extra(api).publicSend(link.token, order.id, 'After revoke')).status()).toBe(404);
    const chat = await extra(api).staffChat(order.id);
    expect(chat.messages.some((message) => message.body === 'Before revoke')).toBeTruthy();
    expect(chat.messages.some((message) => message.body === 'After revoke')).toBeFalsy();
  });
});
