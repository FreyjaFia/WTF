import { expect, test } from '@fixtures/index';
import { SeniorPwdShop } from '@api/senior-pwd';

const PERSON = { type: 1 as const, idNumber: 'SC-5001', customerName: 'Lola Remedios' };

test.describe('Senior / PWD discount edge cases (API) @seniorpwd @orders', () => {
  test('a product with an active promotion price cannot be covered, and nothing is saved', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);
    await shop.promote(drink.id, 80);

    const refused = await shop.placeOrderRaw([{ productId: drink.id, quantity: 1, personIndex: 0 }], [PERSON]);

    expect(refused.ok()).toBeFalsy();
    expect(await refused.text()).toContain('promotion');
    const orders = await shop.owner.json<{ items: unknown[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20');
    expect(orders.items).toHaveLength(0);
  });

  test('a promotion item beside a covered full-price item: only the full-price item is discounted', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const promoted = await shop.product(100);
    const plain = await shop.product(50);
    await shop.promote(promoted.id, 80);

    const placed = await shop.placeOrderRaw(
      [
        { productId: promoted.id, quantity: 1 },
        { productId: plain.id, quantity: 2, personIndex: 0 },
      ],
      [PERSON],
    );

    expect(placed.ok(), await placed.text()).toBeTruthy();
    const order = await placed.json();
    // The promotion item is charged its promotion price (20 off the list: see the promotion), the two plain items 100 less 20%.
    expect(order.seniorPwdPersons[0].coveredAmount).toBe(100);
    expect(order.seniorPwdPersons[0].discountAmount).toBe(20);
  });

  test('a product marked not food or drink cannot be covered', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const mug = await shop.product(250);
    await shop.setEligible(mug.id, false);

    const refused = await shop.placeOrderRaw([{ productId: mug.id, quantity: 1, personIndex: 0 }], [PERSON]);

    expect(refused.ok()).toBeFalsy();
  });

  test('bad people are refused: a missing index target, a person with nothing covered, a wrong type, long values', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);
    const line = { productId: drink.id, quantity: 1, personIndex: 0 };

    const outOfRange = await shop.placeOrderRaw([{ ...line, personIndex: 4 }], [PERSON]);
    const negative = await shop.placeOrderRaw([{ ...line, personIndex: -1 }], [PERSON]);
    const noPerson = await shop.placeOrderRaw([line], []);
    const uncovered = await shop.placeOrderRaw([line], [PERSON, { ...PERSON, idNumber: 'SC-5002', customerName: 'Lolo Ben' }]);
    const wrongType = await shop.placeOrderRaw([line], [{ ...PERSON, type: 3 as unknown as 1 }]);
    const longId = await shop.placeOrderRaw([line], [{ ...PERSON, idNumber: '1'.repeat(51) }]);
    const longName = await shop.placeOrderRaw([line], [{ ...PERSON, customerName: 'n'.repeat(101) }]);
    const blankName = await shop.placeOrderRaw([line], [{ ...PERSON, customerName: '   ' }]);

    for (const refused of [outOfRange, negative, noPerson, uncovered, wrongType, longId, longName, blankName]) {
      expect(refused.ok()).toBeFalsy();
    }
  });

  test('a wrong expected total is refused, the right one is accepted', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: true });
    const drink = await shop.product(100);
    const body = (expectedTotal: number): Record<string, unknown> => ({
      customerId: null,
      items: [{ productId: drink.id, quantity: 1, addOns: [], specialInstructions: null, bundlePromotionId: null, seniorPwdPersonIndex: 0 }],
      bundlePromotions: [],
      seniorPwdPersons: [PERSON],
      status: 2,
      paymentMethod: 1,
      amountReceived: 1000,
      expectedTotal,
    });

    expect((await shop.owner.call('POST', 'orders', body(100))).ok()).toBeFalsy();
    const accepted = await shop.owner.call('POST', 'orders', body(71.43));

    expect(accepted.ok(), await accepted.text()).toBeTruthy();
  });

  test('a cashier can use the ID check, a viewer cannot, and another shop never sees the ID', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const other = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);
    const placed = await shop.placeOrderRaw([{ productId: drink.id, quantity: 1, personIndex: 0 }], [PERSON]);
    expect(placed.ok(), await placed.text()).toBeTruthy();
    const cashier = await shop.signInAs(await shop.cashier());
    const viewer = await shop.signInAs(await shop.viewer());
    const path = `orders/senior-pwd/id-check?idNumber=${encodeURIComponent(PERSON.idNumber)}`;

    const used = await cashier.json<{ usedToday: boolean }>('GET', path);
    const viewerResponse = await viewer.call('GET', path);
    const elsewhere = await other.owner.json<{ usedToday: boolean }>('GET', path);

    expect(used.usedToday).toBe(true);
    expect(viewerResponse.status()).toBe(403);
    expect(elsewhere.usedToday).toBe(false);
  });

  test('the list masks the ID while the cashier sees it in full in the details', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);
    const placed = await shop.placeOrderRaw([{ productId: drink.id, quantity: 1, personIndex: 0 }], [PERSON]);
    const order = await placed.json();

    const list = await shop.owner.json<{ items: { id: string; seniorPwdPersons?: { idNumber: string }[] }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20');
    const details = await shop.owner.json<{ seniorPwdPersons: { idNumber: string }[] }>('GET', `orders/${order.id}`);

    expect(list.items[0].seniorPwdPersons?.[0].idNumber).toBe('****001');
    expect(details.seniorPwdPersons[0].idNumber).toBe('SC-5001');
  });

  test('tips are never covered and the cash change uses the reduced total', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);

    const placed = await shop.owner.call('POST', 'orders', {
      customerId: null,
      items: [{ productId: drink.id, quantity: 1, addOns: [], specialInstructions: null, bundlePromotionId: null, seniorPwdPersonIndex: 0 }],
      bundlePromotions: [],
      seniorPwdPersons: [PERSON],
      status: 2,
      paymentMethod: 1,
      amountReceived: 100,
      tips: 10,
      expectedTotal: 80,
    });

    expect(placed.ok(), await placed.text()).toBeTruthy();
    const order = await placed.json();
    expect(order.totalAmount).toBe(80);
    expect(order.seniorPwdPersons[0].coveredAmount).toBe(100);
    expect(order.changeAmount).toBe(10);
  });

  test('voiding a covered order takes its discount out of the sales', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);
    const placed = await shop.placeOrderRaw([{ productId: drink.id, quantity: 1, personIndex: 0 }], [PERSON]);
    const order = await placed.json();

    const voided = await shop.owner.call('PATCH', `orders/${order.id}/void`, { note: 'wrong order' });

    expect(voided.ok(), await voided.text()).toBeTruthy();
    const after = await voided.json();
    expect(after.status).toBe(4);
    expect(after.totalAmount).toBe(80);
  });
});
