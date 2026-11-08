import { expect, test } from '@fixtures/index';
import { API_ORIGIN } from '@data/env';
import { ROUTES } from '@data/routes';
import { unique } from '@utils/unique';
import { openShop, TestShop } from '@utils/tenants';

interface Link {
  readonly id: string;
  readonly token: string;
}

async function shopWithLink(shop: TestShop): Promise<{ drink: { id: string; name: string }; link: Link }> {
  const drink = await shop.owner.createProduct(unique('Link drink'), 90);
  const customer = await shop.owner.createCustomer();
  await shop.owner.json('PUT', `customers/${customer.id}/ordering-link-access`, { allow: true });
  const link = await shop.owner.json<Link>('POST', `customers/${customer.id}/ordering-links`, {});
  return { drink, link };
}

test.describe('the customer link of a shop that cannot take orders @tenancy @customer-link', () => {
  test('answers 503 with the shop name and phone while the shop is suspended, and works again after a resume', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const { link } = await shopWithLink(shop);
    const catalog = await request.get(`${API_ORIGIN}/api/public/order-links/${link.token}`);
    expect(catalog.ok()).toBeTruthy();

    await platform.setStatus(shop.id, 'suspend');

    const closed = await request.get(`${API_ORIGIN}/api/public/order-links/${link.token}`);
    expect(closed.status()).toBe(503);
    const body = await closed.json();
    expect(body.message).toContain('can\'t take orders');
    expect(body.shopName).toBe(shop.name);

    await platform.setStatus(shop.id, 'resume');
    await expect.poll(async () => (await request.get(`${API_ORIGIN}/api/public/order-links/${link.token}`)).status(), { timeout: 30_000 }).toBe(200);
  });

  test('refuses a new order from the link while the shop is lapsed', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const { drink, link } = await shopWithLink(shop);
    await platform.lapse(shop.id);

    expect((await request.get(`${API_ORIGIN}/api/public/order-links/${link.token}`)).status()).toBe(503);
    const submit = await request.post(`${API_ORIGIN}/api/public/order-links/${link.token}/orders`, {
      data: {
        items: [{ productId: drink.id, quantity: 1, addOns: [], specialInstructions: null }],
        fulfillment: 0, deliveryAddress: null, contactNumber: '09171234567', paymentMethod: 1, amountReceived: 90,
        specialInstructions: null, tips: null, expectedTotal: 90, saveContactNumber: false, saveAddress: false,
      },
    });
    expect(submit.status()).toBe(503);
    expect((await shop.owner.json<{ items: unknown[] }>('GET', 'orders/paged?page=1&pageSize=10')).items).toHaveLength(0);
  });

  test('shows the customer a Try again page with the shop name instead of the menu', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const { link } = await shopWithLink(shop);
    await platform.setStatus(shop.id, 'suspend');
    const page = await (await newContext()).newPage();

    await page.goto(ROUTES.shop(link.token));

    await expect(page.getByRole('heading', { name: 'This shop can\'t take orders right now' })).toBeVisible();
    await expect(page.getByText(shop.name)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('brings the menu back when the customer taps Try again after the shop resumes', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const { drink, link } = await shopWithLink(shop);
    await platform.setStatus(shop.id, 'suspend');
    const page = await (await newContext()).newPage();
    await page.goto(ROUTES.shop(link.token));
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    await platform.setStatus(shop.id, 'resume');
    await expect(async () => {
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('heading', { name: 'This shop can\'t take orders right now' })).toHaveCount(0, { timeout: 2000 });
    }).toPass({ timeout: 40_000 });

    await expect(page.getByText(drink.name)).toBeVisible();
  });

  test('a link keeps answering 404 for unknown links, not "unavailable"', async ({ request }) => {
    const unknown = await request.get(`${API_ORIGIN}/api/public/order-links/not-a-real-token-${Date.now()}`);
    expect(unknown.status()).toBe(404);
  });

  test('an order placed through the link lands in that shop only', async ({ request, platform }) => {
    const shopA = await openShop(request, platform);
    const shopB = await openShop(request, platform);
    const { drink, link } = await shopWithLink(shopA);
    const submit = await request.post(`${API_ORIGIN}/api/public/order-links/${link.token}/orders`, {
      data: {
        items: [{ productId: drink.id, quantity: 1, addOns: [], specialInstructions: null }],
        fulfillment: 0, deliveryAddress: null, contactNumber: '09171234567', paymentMethod: 1, amountReceived: 90,
        specialInstructions: null, tips: null, expectedTotal: 90, saveContactNumber: false, saveAddress: false,
      },
    });
    expect(submit.ok(), await submit.text()).toBeTruthy();
    const placed = await submit.json();

    const inA = await shopA.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=5&page=1&pageSize=50');
    expect(inA.items.map((order) => order.id)).toContain(placed.id);
    const inB = await shopB.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=5&page=1&pageSize=50');
    expect(inB.items).toHaveLength(0);
  });
});
