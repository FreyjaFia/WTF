import { randomUUID } from 'node:crypto';
import { Api } from '@api/index';
import { PromotionsExtra, manilaClock, weekdayBit } from '@api/promotions-extra';
import { expect, test } from '@fixtures/index';
import { OrderStatus } from '@data/enums';
import { isoInDays } from '@utils/dates';
import { PromosTabPage } from '@pages/promos-tab.page';

const PRICE: number = 100;
const AMOUNT_OFF: number = 30;
const DISCOUNTED: number = PRICE - AMOUNT_OFF;

async function drink(api: Api, price: number = PRICE) {
  return api.products.create({ price });
}

test.describe('discounted product pricing @promotions', () => {
  test('an amount off lowers the saved price, total and label of a completed order', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF });

    const order = await promos.sellPlain(product.id, 2);

    expect(order.status).toBe(OrderStatus.Completed);
    expect(order.totalAmount).toBe(DISCOUNTED * 2);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].price).toBe(DISCOUNTED);
    expect(order.items[0].originalPrice).toBe(PRICE);
    expect(order.items[0].promoLabel ?? '').toContain('30');
  });

  test('a percent discount lowers the price by that share', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api, 200);
    await promos.discounted({ productId: product.id, percentOff: 10 });

    const order = await promos.sellPlain(product.id, 1);

    expect(order.totalAmount).toBe(180);
    expect(order.items[0].promoLabel ?? '').toContain('10%');
  });

  test('a product without a promotion is charged the list price', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);

    const order = await promos.sellPlain(product.id, 3);

    expect(order.totalAmount).toBe(PRICE * 3);
    expect(order.items[0].promoLabel ?? null).toBeNull();
  });

  test('an ended promotion gives no discount', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, startDate: isoInDays(-10), endDate: isoInDays(-2) });

    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(PRICE);
  });

  test('a promotion that has not started yet gives no discount', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, startDate: isoInDays(3), endDate: isoInDays(10) });

    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(PRICE);
  });

  test('an inactive promotion gives no discount', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, isActive: false });

    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(PRICE);
  });

  test('a deleted promotion stops applying and a restored one applies again', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    const promotion = await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF });
    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(DISCOUNTED);

    await api.promotions.remove('discounted-products', promotion.id);
    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(PRICE);

    await api.promotions.restore(promotion.id);
    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(DISCOUNTED);
  });
});

test.describe('promotion usage limits @promotions', () => {
  test('uses run out, then the list price is charged', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    const promotion = await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, schedule: { maxRedemptions: 2 } });

    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(DISCOUNTED);
    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(DISCOUNTED);
    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(PRICE);

    const details = await promos.discountedDetails(promotion.id);
    expect(details.schedule?.redemptions).toBe(2);
  });

  test('a line larger than the uses left is discounted only for the uses left', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, schedule: { maxRedemptions: 1 } });

    expect((await promos.sellPlain(product.id, 2)).totalAmount).toBe(DISCOUNTED + PRICE);
  });

  test('voiding a sale gives its use back', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    const promotion = await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, schedule: { maxRedemptions: 1 } });

    const first = await promos.sellPlain(product.id, 1);
    expect(first.totalAmount).toBe(DISCOUNTED);
    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(PRICE);

    const voided = await api.orders.voidOrder(first.id, 'Customer changed mind');
    expect(voided.ok(), await voided.text()).toBeTruthy();

    expect((await promos.discountedDetails(promotion.id)).schedule?.redemptions).toBe(0);
    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(DISCOUNTED);
  });

  test('a limit per order covers only that many items and splits the line in two', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, schedule: { maxPerOrder: 2 } });

    const order = await promos.sellPlain(product.id, 5);

    expect(order.items).toHaveLength(2);
    const covered = order.items.find((line) => line.promoLabel);
    const rest = order.items.find((line) => !line.promoLabel);
    expect(covered?.quantity).toBe(2);
    expect(covered?.price).toBe(DISCOUNTED);
    expect(rest?.quantity).toBe(3);
    expect(rest?.price).toBe(PRICE);
    expect(order.totalAmount).toBe(DISCOUNTED * 2 + PRICE * 3);
  });
});

test.describe('promotion schedule @promotions', () => {
  test('a promotion for tomorrow only gives no discount today', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, schedule: { daysOfWeek: weekdayBit(1) } });

    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(PRICE);
  });

  test('a promotion for today gives the discount', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, schedule: { daysOfWeek: weekdayBit(0) } });

    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(DISCOUNTED);
  });

  test('a daily window that has not opened yet gives no discount', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, schedule: { startTime: manilaClock(120), endTime: manilaClock(180) } });

    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(PRICE);
  });

  test('a daily window around now gives the discount', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF, schedule: { startTime: manilaClock(-60), endTime: manilaClock(60) } });

    expect((await promos.sellPlain(product.id, 1)).totalAmount).toBe(DISCOUNTED);
  });
});

test.describe('fixed bundles @promotions', () => {
  test('the bundle price is charged instead of the product prices', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const latte = await drink(api, 100);
    const croissant = await drink(api, 120);
    const bundle = await promos.fixedBundle([latte.id, croissant.id], 150);

    const order = await promos.sell(
      [
        { productId: latte.id, quantity: 1, bundleId: bundle.id },
        { productId: croissant.id, quantity: 1, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 1 }],
    );

    expect(order.totalAmount).toBe(150);
    expect(order.bundlePromotions?.[0].unitPrice).toBe(150);
  });

  test('two bundles cost twice the bundle price', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const latte = await drink(api, 100);
    const croissant = await drink(api, 120);
    const bundle = await promos.fixedBundle([latte.id, croissant.id], 150);

    const order = await promos.sell(
      [
        { productId: latte.id, quantity: 2, bundleId: bundle.id },
        { productId: croissant.id, quantity: 2, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 2 }],
    );

    expect(order.totalAmount).toBe(300);
  });

  test('a bundle with a missing product is refused and names the bundle', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const latte = await drink(api, 100);
    const croissant = await drink(api, 120);
    const bundle = await promos.fixedBundle([latte.id, croissant.id], 150, { name: `E2E Combo ${Date.now()}` });

    const response = await promos.sellRaw([{ productId: latte.id, quantity: 1, bundleId: bundle.id }], [{ promotionId: bundle.id, quantity: 1 }]);

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('E2E Combo');
  });

  test('a bundle with the wrong quantity of a product is refused', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const latte = await drink(api, 100);
    const croissant = await drink(api, 120);
    const bundle = await promos.fixedBundle([latte.id, croissant.id], 150);

    const response = await promos.sellRaw(
      [
        { productId: latte.id, quantity: 2, bundleId: bundle.id },
        { productId: croissant.id, quantity: 1, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 1 }],
    );

    expect(response.status()).toBe(400);
  });

  test('a bundle with a product that is not in it is refused', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const latte = await drink(api, 100);
    const croissant = await drink(api, 120);
    const stranger = await drink(api, 50);
    const bundle = await promos.fixedBundle([latte.id, croissant.id], 150);

    const response = await promos.sellRaw(
      [
        { productId: latte.id, quantity: 1, bundleId: bundle.id },
        { productId: stranger.id, quantity: 1, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 1 }],
    );

    expect(response.status()).toBe(400);
  });

  test('an ended bundle cannot be sold', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const latte = await drink(api, 100);
    const bundle = await promos.fixedBundle([latte.id], 80, { startDate: isoInDays(-10), endDate: isoInDays(-2) });

    const response = await promos.sellRaw([{ productId: latte.id, quantity: 1, bundleId: bundle.id }], [{ promotionId: bundle.id, quantity: 1 }]);

    expect(response.status()).toBe(400);
  });
});

test.describe('mix and match bundles @promotions', () => {
  test('the required count of listed products costs the bundle price', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const [a, b, c] = [await drink(api, 100), await drink(api, 110), await drink(api, 120)];
    const bundle = await promos.mixMatch([a.id, b.id, c.id], 2, 150);

    const order = await promos.sell(
      [
        { productId: a.id, quantity: 1, bundleId: bundle.id },
        { productId: c.id, quantity: 1, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 1 }],
    );

    expect(order.totalAmount).toBe(150);
  });

  test('fewer products than required are refused', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const [a, b] = [await drink(api, 100), await drink(api, 110)];
    const bundle = await promos.mixMatch([a.id, b.id], 2, 150);

    const response = await promos.sellRaw([{ productId: a.id, quantity: 1, bundleId: bundle.id }], [{ promotionId: bundle.id, quantity: 1 }]);

    expect(response.status()).toBe(400);
  });

  test('more products than required are refused', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const [a, b, c] = [await drink(api, 100), await drink(api, 110), await drink(api, 120)];
    const bundle = await promos.mixMatch([a.id, b.id, c.id], 2, 150);

    const response = await promos.sellRaw(
      [
        { productId: a.id, quantity: 1, bundleId: bundle.id },
        { productId: b.id, quantity: 1, bundleId: bundle.id },
        { productId: c.id, quantity: 1, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 1 }],
    );

    expect(response.status()).toBe(400);
  });

  test('a product that is not on the list is refused', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const [a, b] = [await drink(api, 100), await drink(api, 110)];
    const stranger = await drink(api, 40);
    const bundle = await promos.mixMatch([a.id, b.id], 2, 150);

    const response = await promos.sellRaw(
      [
        { productId: a.id, quantity: 1, bundleId: bundle.id },
        { productId: stranger.id, quantity: 1, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 1 }],
    );

    expect(response.status()).toBe(400);
  });

  test('the maximum per product is enforced', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const [a, b] = [await drink(api, 100), await drink(api, 110)];
    const bundle = await promos.mixMatch([a.id, b.id], 2, 150, { maxSelectionsPerOrder: 1 });

    const twice = await promos.sellRaw([{ productId: a.id, quantity: 2, bundleId: bundle.id }], [{ promotionId: bundle.id, quantity: 1 }]);
    expect(twice.status()).toBe(400);

    const mixed = await promos.sell(
      [
        { productId: a.id, quantity: 1, bundleId: bundle.id },
        { productId: b.id, quantity: 1, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 1 }],
    );
    expect(mixed.totalAmount).toBe(150);
  });
});

test.describe('invalid promotions are refused @promotions', () => {
  test('a negative bundle price', async ({ api }) => {
    const product = await drink(api);
    const response = await new PromotionsExtra(api.client).fixedBundleRaw([product.id], -5);
    expect(response.status()).toBe(400);
  });

  test('a name over 100 characters', async ({ api }) => {
    const product = await drink(api);
    const response = await new PromotionsExtra(api.client).fixedBundleRaw([product.id], 50, { name: 'N'.repeat(101) });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('100');
  });

  test('the same product twice in a fixed bundle', async ({ api }) => {
    const product = await drink(api);
    const response = await new PromotionsExtra(api.client).fixedBundleRaw([product.id, product.id], 50);
    expect(response.status()).toBe(400);
  });

  test('a product that does not exist', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    expect((await promos.fixedBundleRaw([randomUUID()], 50)).status()).toBe(400);
    expect((await promos.discountedRaw({ productId: randomUUID(), amountOff: 10 })).status()).toBe(400);
    expect((await promos.mixMatchRaw([randomUUID()], 1, 50)).status()).toBe(400);
  });

  test('an inactive product', async ({ api }) => {
    const product = await drink(api);
    await api.products.remove(product.id);
    const response = await new PromotionsExtra(api.client).discountedRaw({ productId: product.id, amountOff: 10 });
    expect(response.status()).toBe(400);
  });

  test('a discount with no amount, a zero amount or a percent above 100', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    expect((await promos.discountedRaw({ productId: product.id })).status()).toBe(400);
    expect((await promos.discountedRaw({ productId: product.id, amountOff: 0 })).status()).toBe(400);
    expect((await promos.discountedRaw({ productId: product.id, amountOff: -10 })).status()).toBe(400);
    expect((await promos.discountedRaw({ productId: product.id, percentOff: 150 })).status()).toBe(400);
  });

  test('an end date before the start date', async ({ api }) => {
    const product = await drink(api);
    const response = await new PromotionsExtra(api.client).discountedRaw({
      productId: product.id,
      amountOff: 10,
      startDate: isoInDays(5),
      endDate: isoInDays(2),
    });
    expect(response.status()).toBe(400);
  });

  test('a bad schedule: usage limit 0, one time only, no days', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    expect((await promos.discountedRaw({ productId: product.id, amountOff: 10, schedule: { maxRedemptions: 0 } })).status()).toBe(400);
    expect((await promos.discountedRaw({ productId: product.id, amountOff: 10, schedule: { startTime: '09:00' } })).status()).toBe(400);
    expect((await promos.discountedRaw({ productId: product.id, amountOff: 10, schedule: { daysOfWeek: 0 } })).status()).toBe(400);
  });

  test('a mix and match that needs zero products', async ({ api }) => {
    const product = await drink(api);
    expect((await new PromotionsExtra(api.client).mixMatchRaw([product.id], 0, 50)).status()).toBe(400);
  });

  test('a cashier cannot create a promotion', async ({ api }) => {
    const product = await drink(api);
    const response = await api.client.call('cashier', 'POST', 'management/promotions/discounted-products', {
      body: { name: 'Nope', isActive: true, items: [{ productId: product.id, fixedPrice: 10, percentOff: null, addOns: [] }] },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('promotions in the order editor @promotions @orders', () => {
  test('the Promos tab shows a card for an active discount with its price', async ({ api, signIn }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF });

    const page = await signIn('cashier');
    const editor = new PromosTabPage(page);
    await editor.open();
    await editor.showPromos();
    await editor.editor.search.fill(product.name);

    const card = editor.deal(product.name);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Promo');
    await expect(card).toContainText('70.00');
    await expect(card).toContainText('100.00');
  });

  test('a deleted discount has no card', async ({ api, signIn }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await drink(api);
    const promotion = await promos.discounted({ productId: product.id, amountOff: AMOUNT_OFF });
    await api.promotions.remove('discounted-products', promotion.id);

    const page = await signIn('cashier');
    const editor = new PromosTabPage(page);
    await editor.open();
    await editor.editor.search.fill(product.name);

    await expect(editor.deal(product.name)).toHaveCount(0);
  });
});
