import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import type { SignIn } from '@fixtures/index';
import { OrdersExtraApi } from '@api/orders-extra';
import { OrderStatus } from '@data/enums';
import { KitchenPage } from '@pages/kitchen.page';

async function kitchenOn(signIn: SignIn): Promise<{ page: Page; kitchen: KitchenPage }> {
  const page = await signIn('kitchen');
  const kitchen = new KitchenPage(page);
  await kitchen.open();
  return { page, kitchen };
}

test.describe('the kitchen board @kitchen', () => {
  test('a kitchen cook signs in, lands on the board and works an order through the steps', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 140 });
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }] });

    const page = await signIn('kitchen', { landing: true });
    const kitchen = new KitchenPage(page);
    await expect(page).toHaveURL(/\/kitchen$/);

    const card = kitchen.card(order.orderNumber);
    await expect(card).toBeVisible();
    await expect(card).toContainText(drink.name);
    await expect(card).toContainText('2×');
    await expect(card).not.toContainText('₱');
    await expect(card).not.toContainText('140');

    await expect(kitchen.column('new').getByTestId(`kitchen-card-${order.orderNumber}`)).toBeVisible();
    await kitchen.advance(order.orderNumber);
    await expect(kitchen.column('preparing').getByTestId(`kitchen-card-${order.orderNumber}`)).toBeVisible();
    await kitchen.advance(order.orderNumber);
    await expect(kitchen.column('ready').getByTestId(`kitchen-card-${order.orderNumber}`)).toBeVisible();

    await kitchen.undo(order.orderNumber);
    await expect(kitchen.column('preparing').getByTestId(`kitchen-card-${order.orderNumber}`)).toBeVisible();

    await kitchen.advance(order.orderNumber);
    await kitchen.advance(order.orderNumber);
    await expect(kitchen.card(order.orderNumber)).toHaveCount(0);

    await kitchen.servedTab.click();
    await expect(kitchen.card(order.orderNumber)).toBeVisible();
    await kitchen.card(order.orderNumber).getByTestId('kitchen-bring-back').click();
    await expect(kitchen.card(order.orderNumber)).toHaveCount(0);
    await kitchen.boardTab.click();
    await expect(kitchen.column('ready').getByTestId(`kitchen-card-${order.orderNumber}`)).toBeVisible();
  });

  test('more of an item added to an open order shows an ADDED tag until the kitchen has seen it', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 95 });
    const order = await api.orders.create({ status: OrderStatus.Pending, items: [{ productId: drink.id, quantity: 1 }] });
    const { kitchen } = await kitchenOn(signIn);
    await expect(kitchen.card(order.orderNumber)).toBeVisible();
    await expect(kitchen.card(order.orderNumber).getByTestId('kitchen-change')).toHaveCount(0);

    const response = await new OrdersExtraApi(api.client, api.orders).update(order.id, { status: OrderStatus.Pending, items: [{ productId: drink.id, quantity: 3 }] });
    expect(response.ok()).toBeTruthy();

    await kitchen.card(order.orderNumber).waitFor();
    await kitchen.open();
    const change = kitchen.card(order.orderNumber).getByTestId('kitchen-change');
    await expect(change).toBeVisible();
    await expect(change).toContainText('Added');
    await change.getByTestId('kitchen-seen').click();
    await expect(change).toHaveCount(0);
  });

  test('a cancelled order that is being made shows a stop-making card that can be dismissed', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 120 });
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });
    const { kitchen } = await kitchenOn(signIn);
    await kitchen.advance(order.orderNumber);
    await expect(kitchen.column('preparing').getByTestId(`kitchen-card-${order.orderNumber}`)).toBeVisible();

    const voided = await api.orders.voidOrder(order.id, 'Customer left');
    expect(voided.ok()).toBeTruthy();

    await kitchen.open();
    await expect(kitchen.stopCard(order.orderNumber)).toBeVisible();
    await expect(kitchen.stopCard(order.orderNumber)).toContainText('Stop making');
    await kitchen.stopCard(order.orderNumber).getByTestId('kitchen-dismiss').click();
    await expect(kitchen.stopCard(order.orderNumber)).toHaveCount(0);
  });

  test('the kitchen sees no prices, and cannot read the order list or reports', async ({ api }) => {
    const drink = await api.products.create({ price: 3337 });
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });

    const board = await api.client.call('kitchen', 'GET', 'kitchen/orders');
    expect(board.status()).toBe(200);
    const text = await board.text();
    expect(text).toContain(drink.name);
    expect(text.toLowerCase()).not.toContain('totalamount');
    expect(text.toLowerCase()).not.toContain('price');
    expect(text).not.toContain('3337');

    expect((await api.client.call('kitchen', 'GET', 'orders/paged')).status()).toBe(403);
    expect((await api.client.call('kitchen', 'GET', `orders/${order.id}`)).status()).toBe(403);
    expect((await api.client.call('viewer', 'GET', 'kitchen/orders')).status()).toBe(403);
    expect((await api.client.call('cashier', 'GET', 'kitchen/orders')).status()).toBe(200);
  });

  test('a cashier marks an order served from its details page', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 110 });
    const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });

    const page = await signIn('cashier');
    await page.goto(`/orders/details/${order.id}`);
    await expect(page.getByTestId('order-kitchen-chip')).toContainText('Kitchen: new');
    await page.getByTestId('order-mark-served').click();
    await expect(page.getByTestId('order-kitchen-chip')).toContainText('Served');
    await expect(page.getByTestId('order-mark-served')).toHaveCount(0);
  });
});

test.describe('the kitchen board layout @kitchen @layout', () => {
  const sizes = [
    { name: '375', width: 375, height: 760, columns: false },
    { name: '820', width: 820, height: 1000, columns: true },
    { name: '1440', width: 1440, height: 900, columns: true },
  ] as const;

  for (const size of sizes) {
    test(`at ${size.name}px the board fits the screen and the main button is easy to hit`, async ({ api, signIn }) => {
      const drink = await api.products.create({ price: 90 });
      const order = await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }] });

      const page = await signIn('kitchen');
      await page.setViewportSize({ width: size.width, height: size.height });
      const kitchen = new KitchenPage(page);
      await kitchen.open();

      await expect(kitchen.card(order.orderNumber)).toBeVisible();
      const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasScroll).toBeFalsy();

      const button = kitchen.card(order.orderNumber).getByTestId('kitchen-advance');
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      if (size.columns) {
        await expect(kitchen.column('new')).toBeVisible();
        await expect(kitchen.column('preparing')).toBeVisible();
        await expect(kitchen.column('ready')).toBeVisible();
      } else {
        await expect(kitchen.tab('new')).toBeVisible();
        await expect(kitchen.column('preparing')).toBeHidden();
        await kitchen.advance(order.orderNumber);
        await kitchen.tab('preparing').click();
        await expect(kitchen.card(order.orderNumber)).toBeVisible();
      }

      await page.screenshot({ path: `test-results/kitchen-${size.name}.png`, fullPage: false });
    });
  }
});
