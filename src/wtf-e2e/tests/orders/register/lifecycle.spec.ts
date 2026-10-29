import { Api } from '@api/index';
import { OrdersExtraApi } from '@api/orders-extra';
import { expect, test } from '@fixtures/index';
import { OrderStatus, PaymentMethod } from '@data/enums';
import { OrderDetailsButtons, OrderListRows } from '@pages/order-lifecycle.page';
import { OrderListPage } from '@pages/order-list.page';
import { OrderDetailsPage } from '@pages/order-details.page';

function extra(api: Api): OrdersExtraApi {
  return new OrdersExtraApi(api.client, api.orders);
}

async function trackedDrink(api: Api, stock: number = 20, price: number = 100) {
  const drink = await api.products.create({ price });
  const item = await api.items.create({ startingQuantity: stock });
  await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);
  return { drink, item };
}

test.describe('order lifecycle: pending, completed, voided @orders', () => {
  test('a pending order can be edited and then completed, and only completing takes stock', async ({ api }) => {
    const { drink, item } = await trackedDrink(api);
    const pending = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }], status: OrderStatus.Pending });
    expect(pending.status).toBe(OrderStatus.Pending);
    expect(await api.items.balance(item.id)).toBe(20);

    const edited = await extra(api).update(pending.id, { items: [{ productId: drink.id, quantity: 3 }], status: OrderStatus.Pending });
    expect(edited.status(), await edited.text()).toBe(200);
    expect(await api.items.balance(item.id)).toBe(20);

    const done = await extra(api).complete(pending.id, { items: [{ productId: drink.id, quantity: 3 }], amountReceived: 500 });
    expect(done.status(), await done.text()).toBe(200);
    const order = await api.orders.get(pending.id);
    expect(order.status).toBe(OrderStatus.Completed);
    expect(order.totalAmount).toBe(300);
    expect(await api.items.balance(item.id)).toBe(17);
  });

  test('saving a completed order again through the normal update is refused', async ({ api }) => {
    const { drink, item } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });

    const again = await extra(api).complete(order.id, { items: [{ productId: drink.id, quantity: 4 }] });

    expect(again.status()).toBe(400);
    expect(await again.text()).toContain('cannot be updated');
    expect(await api.items.balance(item.id)).toBe(19);
  });

  test('voiding a pending order cancels it and never touches stock', async ({ api }) => {
    const { drink, item } = await trackedDrink(api);
    const pending = await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }], status: OrderStatus.Pending });

    const response = await api.orders.voidOrder(pending.id, 'Customer left');

    expect(response.status(), await response.text()).toBe(200);
    expect((await api.orders.get(pending.id)).status).toBe(OrderStatus.Cancelled);
    expect(await api.items.balance(item.id)).toBe(20);
    expect(await api.orders.stockMovements(pending.id)).toHaveLength(0);
  });

  test('voiding a completed order needs a note', async ({ api }) => {
    const { drink, item } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });

    for (const note of ['', '   ']) {
      const response = await api.orders.voidOrder(order.id, note);
      expect(response.status()).toBe(400);
      expect(await response.text()).toContain('Refund note is required');
    }
    expect((await api.orders.get(order.id)).status).toBe(OrderStatus.Completed);
    expect(await api.items.balance(item.id)).toBe(19);
  });

  test('a completed order cannot be refunded twice and stock comes back only once', async ({ api }) => {
    const { drink, item } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }] });

    const first = await api.orders.voidOrder(order.id, 'Wrong order', []);
    expect(first.status(), await first.text()).toBe(200);
    const second = await api.orders.voidOrder(order.id, 'Again');

    expect(second.status()).toBe(400);
    expect(await second.text()).toContain('already been voided');
    expect((await api.orders.get(order.id)).status).toBe(OrderStatus.Refunded);
    expect(await api.items.balance(item.id)).toBe(20);
  });

  test('a cancelled order cannot be edited or completed', async ({ api }) => {
    const { drink } = await trackedDrink(api);
    const pending = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }], status: OrderStatus.Pending });
    await api.orders.voidOrder(pending.id, 'Changed mind');

    const response = await extra(api).complete(pending.id, { items: [{ productId: drink.id, quantity: 1 }] });

    expect(response.status()).toBe(400);
    expect((await api.orders.get(pending.id)).status).toBe(OrderStatus.Cancelled);
  });
});

test.describe('Admin override of a completed order @orders @override', () => {
  test('a reason is required and a blank one changes nothing', async ({ api }) => {
    const { drink, item } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });

    for (const reason of [null, '', '   ']) {
      const response = await extra(api).override(order.id, { items: [{ productId: drink.id, quantity: 2 }] }, reason);
      expect(response.status()).toBe(400);
      expect(await response.text()).toContain('override reason is required');
    }
    expect((await api.orders.get(order.id)).items[0].quantity).toBe(1);
    expect(await api.items.balance(item.id)).toBe(19);
  });

  test('a cashier and a viewer are forbidden', async ({ api }) => {
    const { drink } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });

    for (const role of ['cashier', 'viewer'] as const) {
      const response = await extra(api).override(order.id, { items: [{ productId: drink.id, quantity: 2 }] }, 'I want to', role);
      expect(response.status(), role).toBe(403);
    }
    expect((await api.orders.get(order.id)).items[0].quantity).toBe(1);
  });

  test('changing the quantity writes only the net stock difference', async ({ api }) => {
    const { drink, item } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 3 }] });
    expect(await api.items.balance(item.id)).toBe(17);

    const more = await extra(api).override(order.id, { items: [{ productId: drink.id, quantity: 5 }] }, 'Customer added two');
    expect(more.status(), await more.text()).toBe(200);
    expect(await api.items.balance(item.id)).toBe(15);

    const fewer = await extra(api).override(order.id, { items: [{ productId: drink.id, quantity: 4 }] }, 'One was returned');
    expect(fewer.status(), await fewer.text()).toBe(200);
    expect(await api.items.balance(item.id)).toBe(16);

    const saved = await api.orders.get(order.id);
    expect(saved.status).toBe(OrderStatus.Completed);
    expect(saved.totalAmount).toBe(400);
    const movements = await api.orders.stockMovements(order.id);
    const net = movements.reduce((sum, movement) => sum + Number(movement.quantityDelta), 0);
    expect(net).toBe(-4);
    expect(movements).toHaveLength(3);
  });

  test('an override cannot turn a completed order into anything else, and a pending order cannot be overridden', async ({ api }) => {
    const { drink } = await trackedDrink(api);
    const completed = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });
    const pending = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }], status: OrderStatus.Pending });

    const toCancelled = await api.client.call('admin', 'PUT', `orders/${completed.id}/override`, {
      body: { ...api.orders.body({ items: [{ productId: drink.id, quantity: 1 }], status: OrderStatus.Cancelled }), id: completed.id, overrideReason: 'x' },
    });
    expect(toCancelled.status()).toBe(400);

    const onPending = await extra(api).override(pending.id, { items: [{ productId: drink.id, quantity: 2 }] }, 'x');
    expect(onPending.status()).toBe(400);
    expect(await onPending.text()).toContain('Only completed orders');
  });

  test('a product deleted after the sale may stay on the corrected order, but cannot be added elsewhere', async ({ api }) => {
    const gone = await api.products.create({ price: 80 });
    const kept = await api.products.create({ price: 50 });
    const order = await api.orders.create({ items: [{ productId: gone.id, quantity: 1 }, { productId: kept.id, quantity: 1 }] });
    await api.products.remove(gone.id);

    const corrected = await extra(api).override(
      order.id,
      { items: [{ productId: gone.id, quantity: 1 }, { productId: kept.id, quantity: 2 }] },
      'Customer wanted two of the other one',
    );
    expect(corrected.status(), await corrected.text()).toBe(200);
    expect((await api.orders.get(order.id)).totalAmount).toBe(180);

    const addAgain = await api.orders.createRaw({ items: [{ productId: gone.id, quantity: 1 }] });
    expect(addAgain.status()).toBe(400);
    expect(await addAgain.text()).toContain('inactive');
  });
});

test.describe('order input rules at the API @orders', () => {
  test('a changed expected total is refused with a clear message and nothing is saved', async ({ api }) => {
    const { drink, item } = await trackedDrink(api, 20, 100);

    const response = await extra(api).createWith({ items: [{ productId: drink.id, quantity: 2 }] }, { expectedTotal: 150 });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('The total changed');
    expect(await api.items.balance(item.id)).toBe(20);
  });

  test('the right expected total is accepted', async ({ api }) => {
    const { drink } = await trackedDrink(api, 20, 100);

    const response = await extra(api).createWith({ items: [{ productId: drink.id, quantity: 2 }] }, { expectedTotal: 200 });

    expect(response.status(), await response.text()).toBe(201);
  });

  test('cash below the total is refused', async ({ api }) => {
    const { drink, item } = await trackedDrink(api, 20, 100);

    const response = await api.orders.createRaw({
      items: [{ productId: drink.id, quantity: 2 }],
      paymentMethod: PaymentMethod.Cash,
      amountReceived: 150,
    });

    expect(response.status()).toBe(400);
    expect(await api.items.balance(item.id)).toBe(20);
  });

  for (const quantity of [0, -1, -50]) {
    test(`an item quantity of ${quantity} is refused`, async ({ api }) => {
      const { drink } = await trackedDrink(api);

      const response = await api.orders.createRaw({ items: [{ productId: drink.id, quantity }] });

      expect(response.status()).toBe(400);
    });
  }

  test('an order with no items is refused', async ({ api }) => {
    const response = await api.orders.createRaw({ items: [] });
    expect(response.status()).toBe(400);
  });

  test('a deleted product is refused with its name', async ({ api }) => {
    const gone = await api.products.create({ price: 60 });
    await api.products.remove(gone.id);

    const response = await api.orders.createRaw({ items: [{ productId: gone.id, quantity: 1 }] });

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain(gone.name);
  });

  test('an unknown product is refused', async ({ api }) => {
    const response = await api.orders.createRaw({ items: [{ productId: '00000000-0000-4000-8000-00000000e2e1', quantity: 1 }] });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('not found');
  });

  test('an unknown customer is refused', async ({ api }) => {
    const { drink } = await trackedDrink(api);
    const response = await api.orders.createRaw({
      items: [{ productId: drink.id, quantity: 1 }],
      customerId: '00000000-0000-4000-8000-00000000e2e2',
    });
    expect(response.status()).toBe(400);
  });

  test('staff cannot create an order straight into waiting for approval', async ({ api }) => {
    const { drink } = await trackedDrink(api);
    const response = await api.orders.createRaw({ items: [{ productId: drink.id, quantity: 1 }], status: OrderStatus.PendingApproval });
    expect(response.status()).toBe(400);
  });

  test('an order waiting for approval cannot be edited, completed or voided from the POS', async ({ api }) => {
    const { drink } = await trackedDrink(api);
    const { link } = await api.customers.withLink();
    const waiting = await api.shop.submit(link.token, [{ productId: drink.id, quantity: 1 }], 100);

    const edit = await extra(api).update(waiting.id, { items: [{ productId: drink.id, quantity: 2 }], status: OrderStatus.Pending });
    const complete = await extra(api).complete(waiting.id, { items: [{ productId: drink.id, quantity: 1 }] });
    const voided = await api.orders.voidOrder(waiting.id, 'x');

    for (const response of [edit, complete, voided]) {
      expect(response.status()).toBe(400);
      expect(await response.text()).toContain('waiting for approval');
    }
    expect((await api.orders.get(waiting.id)).status).toBe(OrderStatus.PendingApproval);
  });

  test('a viewer cannot create, edit or void orders', async ({ api }) => {
    const { drink } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }], status: OrderStatus.Pending });

    expect((await api.orders.createRaw({ items: [{ productId: drink.id, quantity: 1 }] }, 'viewer')).status()).toBe(403);
    expect((await extra(api).complete(order.id, { items: [{ productId: drink.id, quantity: 1 }] }, 'viewer')).status()).toBe(403);
    expect((await api.orders.voidOrder(order.id, 'x', [], 'viewer')).status()).toBe(403);
  });
});

test.describe('order screens @orders', () => {
  test('a row in the order list opens that order\'s details', async ({ api, signIn }) => {
    const { drink } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });
    const page = await signIn('cashier');
    const list = new OrderListPage(page);
    const rows = new OrderListRows(page);

    await list.open();
    await rows.openOrder(order.orderNumber);

    await expect(page).toHaveURL(new RegExp(`/orders/details/${order.id}`));
    await expect(page.getByText('Order total')).toBeVisible();
  });

  test('a viewer sees the details with no refund or override buttons', async ({ api, signIn }) => {
    const { drink } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });
    const page = await signIn('viewer');
    const details = new OrderDetailsPage(page);
    const buttons = new OrderDetailsButtons(page);

    await details.open(order.id);

    await expect(page.getByText('Order total')).toBeVisible();
    await expect(buttons.refund).toHaveCount(0);
    await expect(buttons.override).toHaveCount(0);
  });

  test('an Admin sees the Override button on a completed order, a cashier does not', async ({ api, signIn }) => {
    const { drink } = await trackedDrink(api);
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });
    const adminPage = await signIn('admin');
    await new OrderDetailsPage(adminPage).open(order.id);
    await expect(new OrderDetailsButtons(adminPage).override).toBeVisible();
    await expect(new OrderDetailsButtons(adminPage).refund).toBeVisible();

    const cashierPage = await signIn('cashier');
    await new OrderDetailsPage(cashierPage).open(order.id);
    await expect(new OrderDetailsButtons(cashierPage).override).toHaveCount(0);
  });
});
