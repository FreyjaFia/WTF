import { Api } from '@api/index';
import { OrdersExtraApi } from '@api/orders-extra';
import { expect, test } from '@fixtures/index';
import { FulfillmentType, OrderSource, OrderStatus, PaymentMethod } from '@data/enums';

test.describe.configure({ timeout: 180_000 });

function extra(api: Api): OrdersExtraApi {
  return new OrdersExtraApi(api.client, api.orders);
}

async function linkWithDrink(api: Api, price: number = 100) {
  const drink = await api.products.create({ price });
  const { customer, link } = await api.customers.withLink();
  return { drink, customer, link };
}

test.describe('customer link submit rules @orders @customer-link', () => {
  test('a delivery without an address is refused, with an address it is accepted', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api);
    const line = [{ productId: drink.id, quantity: 1 }];

    const without = await extra(api).submitRaw(link.token, { items: line, fulfillment: FulfillmentType.Delivery, deliveryAddress: '   ' });
    expect(without.status()).toBe(400);
    expect(await without.text()).toContain('delivery address is required');

    const withAddress = await extra(api).submitRaw(link.token, { items: line, fulfillment: FulfillmentType.Delivery, deliveryAddress: '12 Mango St' });
    expect(withAddress.status(), await withAddress.text()).toBe(200);
  });

  test('a delivery address over 300 characters is refused', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api);

    const response = await extra(api).submitRaw(link.token, {
      items: [{ productId: drink.id, quantity: 1 }],
      fulfillment: FulfillmentType.Delivery,
      deliveryAddress: 'x'.repeat(301),
    });

    expect(response.status()).toBe(400);
  });

  for (const contact of [null, '', 'abc-defg', '12345', '<script>']) {
    test(`a contact number of ${JSON.stringify(contact)} is refused`, async ({ api }) => {
      const { drink, link } = await linkWithDrink(api);

      const response = await extra(api).submitRaw(link.token, { items: [{ productId: drink.id, quantity: 1 }], contactNumber: contact });

      expect(response.status()).toBe(400);
    });
  }

  test('a contact number with spaces, plus and dashes is accepted', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api);

    const response = await extra(api).submitRaw(link.token, {
      items: [{ productId: drink.id, quantity: 1 }],
      contactNumber: '+63 917-123 4567',
    });

    expect(response.status(), await response.text()).toBe(200);
  });

  test('cash below the total is refused, and cash that covers the total plus the tip is accepted', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api, 100);
    const line = [{ productId: drink.id, quantity: 1 }];

    const short = await extra(api).submitRaw(link.token, { items: line, amountReceived: 99 });
    expect(short.status()).toBe(400);
    expect(await short.text()).toContain('cash amount');

    const coversTotalNotTip = await extra(api).submitRaw(link.token, { items: line, amountReceived: 110, tips: 20 });
    expect(coversTotalNotTip.status()).toBe(400);
    expect(await coversTotalNotTip.text()).toContain('total and tip');

    const noAmount = await extra(api).submitRaw(link.token, { items: line, amountReceived: null });
    expect(noAmount.status()).toBe(400);

    const exact = await extra(api).submitRaw(link.token, { items: line, amountReceived: 120, tips: 20 });
    expect(exact.status(), await exact.text()).toBe(200);
  });

  test('a tip is stored on the order and does not change the total', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api, 100);

    const order = await extra(api).place(link.token, { items: [{ productId: drink.id, quantity: 2 }], amountReceived: 250, tips: 15 });

    const saved = await api.client.json<Record<string, unknown>>('superadmin', 'GET', `orders/${order.id}`);
    expect(Number(saved.tips)).toBe(15);
    expect(Number(saved.totalAmount)).toBe(200);
    expect(saved.status).toBe(OrderStatus.PendingApproval);
    expect(saved.source).toBe(OrderSource.CustomerLink);
  });

  test('a negative tip is refused', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api);

    const response = await extra(api).submitRaw(link.token, { items: [{ productId: drink.id, quantity: 1 }], tips: -5 });

    expect(response.status()).toBe(400);
  });

  test('31 different lines are refused and 30 are accepted', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api, 10);
    const lines = (count: number) => Array.from({ length: count }, () => ({ productId: drink.id, quantity: 1 }));

    const tooMany = await extra(api).submitRaw(link.token, { items: lines(31) });
    expect(tooMany.status()).toBe(400);
    expect(await tooMany.text()).toContain('at most 30');

    const allowed = await extra(api).submitRaw(link.token, { items: lines(30) });
    expect(allowed.status(), await allowed.text()).toBe(200);
  });

  for (const quantity of [0, -1, 100]) {
    test(`an item quantity of ${quantity} is refused`, async ({ api }) => {
      const { drink, link } = await linkWithDrink(api);

      const response = await extra(api).submitRaw(link.token, { items: [{ productId: drink.id, quantity }] });

      expect(response.status()).toBe(400);
    });
  }

  test('an empty order and an unknown or deleted product are refused', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api);
    await api.products.remove(drink.id);

    expect((await extra(api).submitRaw(link.token, { items: [] })).status()).toBe(400);
    expect((await extra(api).submitRaw(link.token, { items: [{ productId: drink.id, quantity: 1 }] })).status()).toBe(400);
    const unknown = await extra(api).submitRaw(link.token, { items: [{ productId: '00000000-0000-4000-8000-00000000e2e3', quantity: 1 }] });
    expect(unknown.status()).toBe(400);
  });

  test('a wrong expected total is refused and the right one is accepted', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api, 100);
    const line = [{ productId: drink.id, quantity: 1 }];

    const wrong = await extra(api).submitRaw(link.token, { items: line, expectedTotal: 90 });
    expect(wrong.status()).toBe(400);
    expect(await wrong.text()).toContain('The total changed');

    const right = await extra(api).submitRaw(link.token, { items: line, expectedTotal: 100 });
    expect(right.status(), await right.text()).toBe(200);
  });

  test('a sixth order waiting for confirmation is refused, and answering one frees a place', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api, 10);
    const line = [{ productId: drink.id, quantity: 1 }];
    const placed: string[] = [];
    for (let index = 0; index < 5; index++) {
      placed.push((await extra(api).place(link.token, { items: line })).id);
    }

    const sixth = await extra(api).submitRaw(link.token, { items: line });
    expect(sixth.status()).toBe(400);
    expect(await sixth.text()).toContain('waiting for confirmation');

    await api.orders.approve(placed[0]);
    const again = await extra(api).submitRaw(link.token, { items: line });
    expect(again.status(), await again.text()).toBe(200);
  });

  test('the size add-on rule is enforced, and an order with the size is priced with it', async ({ api }) => {
    const { drink, size } = await api.products.withSize(150, 20);
    const { link } = await api.customers.withLink();

    const missing = await extra(api).submitRaw(link.token, { items: [{ productId: drink.id, quantity: 1 }] });
    expect(missing.status()).toBe(400);
    expect(await missing.text()).toContain('size selection is required');

    const twoSizes = await extra(api).submitRaw(link.token, {
      items: [{ productId: drink.id, quantity: 1, addOns: [{ productId: size.id, quantity: 2 }] }],
    });
    expect(twoSizes.status(), 'a size with quantity 2 is not exactly one').toBe(400);

    const ok = await extra(api).submitRaw(link.token, {
      items: [{ productId: drink.id, quantity: 1, addOns: [{ productId: size.id, quantity: 1 }] }],
      expectedTotal: 170,
    });
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('an add-on that does not belong to the product is refused', async ({ api }) => {
    const drink = await api.products.create({ price: 100 });
    const stranger = await api.products.create({ isAddOn: true, price: 10 });
    const { link } = await api.customers.withLink();

    const response = await extra(api).submitRaw(link.token, {
      items: [{ productId: drink.id, quantity: 1, addOns: [{ productId: stranger.id, quantity: 1 }] }],
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('not allowed');
  });

  test('a GCash order stores no cash amount', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api, 100);

    const order = await extra(api).place(link.token, {
      items: [{ productId: drink.id, quantity: 1 }],
      paymentMethod: PaymentMethod.GCash,
      amountReceived: null,
    });

    const saved = await api.client.json<Record<string, unknown>>('superadmin', 'GET', `orders/${order.id}`);
    expect(saved.amountReceived ?? null).toBeNull();
  });
});

test.describe('customer link access @orders @customer-link', () => {
  test('unknown, revoked and expired tokens all answer with the same 404', async ({ api }) => {
    const { customer, link } = await api.customers.withLink();
    const revokedLink = await api.customers.createLink(customer.id);
    await api.customers.revokeLink(customer.id, revokedLink.id);
    const soon = new Date(Date.now() + 4000).toISOString();
    const expiring = await extra(api).createLinkWithExpiry(customer.id, soon);
    expect(expiring.status(), await expiring.text()).toBe(200);
    const expiringToken = (await expiring.json()).token as string;

    await expect.poll(async () => (await extra(api).publicCatalog(expiringToken)).status(), { timeout: 30_000 }).toBe(404);

    const answers = [];
    for (const token of ['this-token-never-existed-e2e', revokedLink.token, expiringToken]) {
      const response = await extra(api).publicCatalog(token);
      answers.push({ status: response.status(), body: await response.text() });
    }
    expect(new Set(answers.map((answer) => answer.status))).toEqual(new Set([404]));
    expect(new Set(answers.map((answer) => answer.body)).size).toBe(1);
    expect((await extra(api).publicCatalog(link.token)).status()).toBe(200);
  });

  test('every public route answers 404 for a revoked token, including submit', async ({ api }) => {
    const { drink, customer, link } = await linkWithDrink(api);
    const placed = await extra(api).place(link.token, { items: [{ productId: drink.id, quantity: 1 }] });
    await api.customers.revokeLink(customer.id, link.id);

    expect((await extra(api).publicOrders(link.token)).status()).toBe(404);
    expect((await extra(api).publicOrder(link.token, placed.id)).status()).toBe(404);
    expect((await extra(api).submitRaw(link.token, { items: [{ productId: drink.id, quantity: 1 }] })).status()).toBe(404);
    expect((await extra(api).publicChat(link.token, placed.id)).status()).toBe(404);
  });

  test('revoking a link does not stop staff from answering orders already placed', async ({ api }) => {
    const { drink, customer, link } = await linkWithDrink(api);
    const placed = await extra(api).place(link.token, { items: [{ productId: drink.id, quantity: 1 }] });
    await api.customers.revokeLink(customer.id, link.id);

    await api.orders.approve(placed.id);

    expect((await api.orders.get(placed.id)).status).toBe(OrderStatus.Pending);
  });

  test('disabling ordering for a customer revokes every link, and enabling it again does not bring them back', async ({ api }) => {
    const { customer, link } = await api.customers.withLink();
    const second = await api.customers.createLink(customer.id);
    expect((await extra(api).publicCatalog(link.token)).status()).toBe(200);

    const disabled = await extra(api).setLinkAccess(customer.id, false);
    expect(disabled.status(), await disabled.text()).toBeLessThan(300);

    expect((await extra(api).publicCatalog(link.token)).status()).toBe(404);
    expect((await extra(api).publicCatalog(second.token)).status()).toBe(404);

    await extra(api).setLinkAccess(customer.id, true);
    expect((await extra(api).publicCatalog(link.token)).status()).toBe(404);
    const fresh = await api.customers.createLink(customer.id);
    expect((await extra(api).publicCatalog(fresh.token)).status()).toBe(200);
  });

  test('a link cannot be created while ordering is disabled, nor with an end date in the past', async ({ api }) => {
    const customer = await api.customers.create();
    const disabled = await api.client.call('admin', 'POST', `customers/${customer.id}/ordering-links`, { body: {} });
    expect(disabled.status()).toBe(400);

    await api.customers.allowLinks(customer.id);
    const past = await extra(api).createLinkWithExpiry(customer.id, new Date(Date.now() - 60_000).toISOString());
    expect(past.status()).toBe(400);
  });

  test('a customer cannot read another customer\'s order through their own link', async ({ api }) => {
    const { drink, link: linkA } = await linkWithDrink(api);
    const { link: linkB } = await api.customers.withLink();
    const mine = await extra(api).place(linkA.token, { items: [{ productId: drink.id, quantity: 1 }] });

    expect((await extra(api).publicOrder(linkA.token, mine.id)).status()).toBe(200);
    expect((await extra(api).publicOrder(linkB.token, mine.id)).status()).toBe(404);
    const listB = await (await extra(api).publicOrders(linkB.token)).json();
    expect(JSON.stringify(listB)).not.toContain(mine.id);
  });

  test('a point-of-sale order of the same customer is not visible through the link', async ({ api }) => {
    const drink = await api.products.create({ price: 100 });
    const { customer, link } = await api.customers.withLink();
    const posOrder = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }], customerId: customer.id });

    expect((await extra(api).publicOrder(link.token, posOrder.id)).status()).toBe(404);
  });

  test('the public order shows no staff or audit details', async ({ api }) => {
    const { drink, link } = await linkWithDrink(api);
    const placed = await extra(api).place(link.token, { items: [{ productId: drink.id, quantity: 1 }] });

    const body = JSON.stringify(await (await extra(api).publicOrder(link.token, placed.id)).json());

    for (const secret of ['createdBy', 'updatedBy', 'userId', 'customer-link']) {
      expect(body).not.toContain(secret);
    }
  });

  test('a viewer and a stock manager cannot create links, a cashier can', async ({ api }) => {
    const customer = await api.customers.create();
    await api.customers.allowLinks(customer.id);

    expect((await api.client.call('viewer', 'POST', `customers/${customer.id}/ordering-links`, { body: {} })).status()).toBe(403);
    expect((await api.client.call('stockmgr', 'POST', `customers/${customer.id}/ordering-links`, { body: {} })).status()).toBe(403);
    expect((await api.client.call('cashier', 'POST', `customers/${customer.id}/ordering-links`, { body: {} })).status()).toBe(200);
  });
});
