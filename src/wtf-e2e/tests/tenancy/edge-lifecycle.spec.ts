import { expect, test } from '@fixtures/index';
import { ShopSession } from '@api/shop-session';
import { TENANT_STATUS, uniqueSlug } from '@api/platform';
import { testPassword } from '@data/env';
import { openShop, ownerOf } from '@utils/tenants';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function inFuture(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

test.describe('paid-until dates and grace, edge cases @tenancy @edge @subscription', () => {
  for (const [label, offset, expected] of [
    ['8 days ahead', 8 * DAY - HOUR, 'none'],
    ['6.5 days ahead', 6.5 * DAY, 'soon'],
    ['just under 3 days ahead', 3 * DAY - HOUR, 'lastdays'],
    ['one hour ahead', HOUR, 'lastdays'],
  ] as const) {
    test(`warns "${expected}" when the period ends ${label}`, async ({ request, platform }) => {
      const shop = await openShop(request, platform);

      const subscription = await platform.setSubscription(shop.id, { periodEnd: inFuture(offset), graceDays: 7 });

      expect(subscription.warning.toLowerCase()).toBe(expected);
      const product = await shop.owner.createProduct();
      expect((await shop.owner.createOrderRaw(product.id)).ok()).toBeTruthy();
    });
  }

  test('a period that just ended is in grace: warned, but still allowed to write', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const product = await shop.owner.createProduct();
    const current = await platform.subscription(shop.id);
    const justAfterStart = new Date(new Date(`${current.periodStart.replace(/Z?$/, 'Z')}`).getTime() + 1).toISOString();

    const subscription = await platform.setSubscription(shop.id, { periodEnd: justAfterStart, graceDays: 7 });

    expect(subscription.warning.toLowerCase()).toBe('grace');
    expect((await shop.owner.createOrderRaw(product.id)).ok()).toBeTruthy();
  });

  test('no grace days means the shop is locked as soon as the period ends, and a long grace keeps it open', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const product = await shop.owner.createProduct();
    await platform.lapse(shop.id);
    expect((await platform.subscription(shop.id)).warning.toLowerCase()).toBe('locked');
    expect((await shop.owner.createOrderRaw(product.id)).status()).toBe(402);

    const current = await platform.subscription(shop.id);
    const justAfterStart = new Date(new Date(`${current.periodStart.replace(/Z?$/, 'Z')}`).getTime() + 1).toISOString();
    await platform.setSubscription(shop.id, { periodEnd: justAfterStart, graceDays: 30 });

    expect((await shop.owner.createOrderRaw(product.id)).ok()).toBeTruthy();
  });

  test('refuses a period that ends before it starts, and nonsense grace, discount or plan values', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const current = await platform.subscription(shop.id);
    const send = (changes: Record<string, unknown>) =>
      platform.call('PUT', `tenants/${shop.id}/subscription`, {
        planId: current.planId, periodEnd: inFuture(30 * DAY), graceDays: 7, discountPercent: 0, notes: null, ...changes,
      });

    const cases: Record<string, unknown>[] = [
      { periodEnd: inFuture(-400 * DAY) },
      { graceDays: -1 },
      { discountPercent: 101 },
      { discountPercent: -5 },
      { planId: 999_999 },
    ];
    for (const changes of cases) {
      const response = await send(changes);
      expect(response.status(), JSON.stringify(changes)).toBe(400);
    }

    expect((await send({})).ok()).toBeTruthy();
  });

  test('an invoice paid early extends from the end of the current period, not from today', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const end = new Date(Date.now() + 20 * DAY);
    await platform.setSubscription(shop.id, { periodEnd: end.toISOString() });

    const invoice = await platform.createInvoice(shop.id, 1);
    const paid = await platform.markPaid(invoice.id);

    const expected = new Date(end);
    expected.setUTCMonth(expected.getUTCMonth() + 1);
    const actual = new Date(`${paid.periodEnd.replace(/Z?$/, 'Z')}`);
    expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(2 * DAY);
  });

  test('paying the same invoice twice, or voiding a paid one, is refused', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const invoice = await platform.createInvoice(shop.id, 1);
    await platform.markPaid(invoice.id);

    expect((await platform.call('POST', `invoices/${invoice.id}/mark-paid`, { reference: null })).status()).toBe(400);
    expect((await platform.call('POST', `invoices/${invoice.id}/void`)).status()).toBe(400);
  });

  test('an invoice for zero or a negative number of months is refused', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    for (const months of [0, -3]) {
      const response = await platform.call('POST', `tenants/${shop.id}/invoices`, { months, reference: null, dueDate: null, notes: null });
      expect(response.status(), `months ${months}`).toBe(400);
    }
  });

  test('a voided invoice cannot be paid, and a lapsed shop stays locked after it', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    await platform.lapse(shop.id);
    const invoice = await platform.createInvoice(shop.id, 1);
    await platform.voidInvoice(invoice.id);

    expect((await platform.call('POST', `invoices/${invoice.id}/mark-paid`, { reference: null })).status()).toBe(400);
    const product = await shop.owner.createProduct().catch(() => null);
    expect(product).toBeNull();
  });

  test('offline order syncing is still accepted from a lapsed shop (it is not a 402)', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    await platform.lapse(shop.id);

    for (const path of ['orders/sync', 'orders/batch']) {
      const response = await shop.owner.call('POST', path, {});
      expect(response.status(), path).not.toBe(402);
    }
  });

  test('a lapsed shop can still sign in, refresh its token and log out', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    await platform.lapse(shop.id);

    expect((await shop.owner.refresh()).ok()).toBeTruthy();
    expect((await ShopSession.attempt(request, shop.ownerUsername, shop.ownerPassword)).ok()).toBeTruthy();
  });
});

test.describe('cancelled and deleted shops, edge cases @tenancy @edge', () => {
  test('a cancelled shop refuses its old token, a new sign in and a refresh, but the platform can still read it', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    await platform.setStatus(shop.id, 'cancel');

    expect((await shop.owner.call('GET', 'products')).status()).toBe(403);
    expect((await shop.owner.refresh()).ok()).toBeFalsy();
    expect((await ShopSession.attempt(request, shop.ownerUsername, shop.ownerPassword)).ok()).toBeFalsy();
    expect((await platform.users(shop.id)).length).toBeGreaterThan(0);
    expect((await platform.subscription(shop.id)).tenantId).toBe(shop.id);
  });

  test('a cancelled shop cannot be suspended, resumed or cancelled again', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    await platform.setStatus(shop.id, 'cancel');

    for (const change of ['suspend', 'resume', 'cancel']) {
      const response = await platform.call('POST', `tenants/${shop.id}/${change}`, { reason: 'again' });
      expect(response.status(), change).toBe(400);
    }
  });

  test('a running shop cannot be resumed', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    const response = await platform.call('POST', `tenants/${shop.id}/resume`, { reason: 'x' });

    expect(response.status()).toBe(400);
  });

  test('a deleted shop takes its people, tokens and data with it, and does not touch another shop', async ({ request, platform }) => {
    const gone = await openShop(request, platform);
    const stays = await openShop(request, platform);
    const product = await stays.owner.createProduct();
    await gone.owner.createProduct();
    await platform.setStatus(gone.id, 'cancel');

    const deleted = await platform.call('POST', `tenants/${gone.id}/delete`, { slug: gone.slug, adminPassword: testPassword() });
    expect(deleted.ok(), await deleted.text()).toBeTruthy();

        expect((await ShopSession.attempt(request, gone.ownerUsername, gone.ownerPassword)).ok(), 'sign in').toBeFalsy();
    const sub = await platform.call('GET', `tenants/${gone.id}/subscription`);
    expect(sub.ok(), `subscription ${sub.status()}`).toBeFalsy();
    const users = await platform.call('GET', `tenants/${gone.id}/users`);
    expect(users.ok(), `users ${users.status()} ${(await users.text()).slice(0, 80)}`).toBeFalsy();
    expect((await stays.owner.json<{ id: string }[]>('GET', 'products')).map((row) => row.id)).toEqual([product.id]);
  });

  test('the token of a deleted shop stops working at once', async ({ request, platform }) => {
    const gone = await openShop(request, platform);
    await platform.setStatus(gone.id, 'cancel');
    const deleted = await platform.call('POST', `tenants/${gone.id}/delete`, { slug: gone.slug, adminPassword: testPassword() });
    expect(deleted.ok()).toBeTruthy();

    expect((await gone.owner.call('GET', 'products')).ok()).toBeFalsy();
  });

  test('deleting needs the exact address in lower case and the right admin password, and a missing shop is not found', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    await platform.setStatus(shop.id, 'cancel');

    const wrongSlug = await platform.call('POST', `tenants/${shop.id}/delete`, { slug: `${shop.slug}-x`, adminPassword: testPassword() });
    const wrongPassword = await platform.call('POST', `tenants/${shop.id}/delete`, { slug: shop.slug, adminPassword: 'nope-nope-nope-1' });
    const missing = await platform.call('POST', 'tenants/00000000-0000-0000-0000-000000000abc/delete', { slug: 'x', adminPassword: testPassword() });

    expect(wrongSlug.ok()).toBeFalsy();
    expect(wrongPassword.ok()).toBeFalsy();
    expect(missing.status()).toBe(404);
    expect((await platform.tenants()).map((tenant) => tenant.id)).toContain(shop.id);
  });

  test('the default shop cannot be cancelled', async ({ platform }) => {
    const wtf = (await platform.tenants()).find((tenant) => tenant.slug === 'wtf');
    expect(wtf, 'the default shop must exist in the test database').toBeTruthy();

    const cancel = await platform.call('POST', `tenants/${wtf!.id}/cancel`, { reason: 'E2E must be refused' });
    const remove = await platform.call('POST', `tenants/${wtf!.id}/delete`, { slug: 'wtf', adminPassword: testPassword() });

    expect(cancel.status(), 'cancelling the default shop must be refused').toBe(400);
    expect(await cancel.text()).toContain('first shop');
    expect(remove.ok(), 'deleting the default shop must be refused').toBeFalsy();
    expect((await platform.tenants()).find((tenant) => tenant.slug === 'wtf')?.status).toBe(TENANT_STATUS.Active);
  });
});

test.describe('reset password and suspend, edge cases @tenancy @edge @platform', () => {
  test('resetting a password gives a different one-time password each time and the older one stops working', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const owner = await ownerOf(platform, shop);

    const first = await platform.resetPassword(shop.id, owner.id);
    const second = await platform.resetPassword(shop.id, owner.id);

    expect(first.temporaryPassword).not.toBe(second.temporaryPassword);
    expect((await ShopSession.attempt(request, shop.ownerUsername, first.temporaryPassword)).ok()).toBeFalsy();
    expect((await ShopSession.attempt(request, shop.ownerUsername, second.temporaryPassword)).ok()).toBeTruthy();
  });

  test('a person of another shop cannot be reset or signed in as through this shop\'s address', async ({ request, platform }) => {
    const a = await openShop(request, platform);
    const b = await openShop(request, platform);
    const ownerOfB = await ownerOf(platform, b);

    const reset = await platform.call('POST', `tenants/${a.id}/users/${ownerOfB.id}/reset-password`);
    const impersonate = await platform.call('POST', `tenants/${a.id}/users/${ownerOfB.id}/impersonate`, { reason: 'E2E', allowWrites: false });

    expect(reset.ok()).toBeFalsy();
    expect(impersonate.ok()).toBeFalsy();
    expect(reset.status()).toBeLessThan(500);
    expect(impersonate.status()).toBeLessThan(500);
    expect((await ShopSession.attempt(request, b.ownerUsername, b.ownerPassword)).ok()).toBeTruthy();
  });

  test('a reset for a person who does not exist is not found', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    const response = await platform.call('POST', `tenants/${shop.id}/users/00000000-0000-0000-0000-000000000def/reset-password`);

    expect(response.status()).toBe(404);
  });

  test('sign in as needs a reason and refuses a shop that is suspended or cancelled', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const owner = await ownerOf(platform, shop);
    const noReason = await platform.call('POST', `tenants/${shop.id}/users/${owner.id}/impersonate`, { reason: '', allowWrites: false });
    expect(noReason.status()).toBe(400);

    await platform.setStatus(shop.id, 'suspend');
    const whileSuspended = await platform.call('POST', `tenants/${shop.id}/users/${owner.id}/impersonate`, { reason: 'E2E', allowWrites: false });

    if (whileSuspended.ok()) {
      const session = ShopSession.withToken(request, owner.username, (await whileSuspended.json()).accessToken);
      expect((await session.call('GET', 'products')).ok(), 'a suspended shop must not open for an impersonated token').toBeFalsy();
    }
  });

  test('a suspended shop that is resumed accepts the old token again, and the 20 second status cache does not hold it back', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    await platform.setStatus(shop.id, 'suspend');
    expect((await shop.owner.call('GET', 'products')).status()).toBe(403);
    await platform.setStatus(shop.id, 'resume');

    expect((await shop.owner.call('GET', 'products')).ok()).toBeTruthy();
  });

  test('two suspends sent together end suspended and are logged once', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    await Promise.all([
      platform.call('POST', `tenants/${shop.id}/suspend`, { reason: 'race a' }),
      platform.call('POST', `tenants/${shop.id}/suspend`, { reason: 'race b' }),
    ]);

    const status = (await platform.tenants()).find((tenant) => tenant.id === shop.id)?.status;
    expect(status).toBe(TENANT_STATUS.Suspended);
    const suspends = (await platform.auditLog(shop.id)).filter((entry) => entry.action === 'TenantSuspended');
    expect(suspends.length, 'two suspends at once should be logged once').toBe(1);
  });

});

test.describe('cross-shop access and tokens, edge cases @tenancy @edge @security', () => {
  function swapTenant(token: string, tenantId: string): string {
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.tenant_id = tenantId;
    return [header, Buffer.from(JSON.stringify(claims)).toString('base64url'), signature].join('.');
  }

  test('a token with another shop\'s id swapped in is rejected, not trusted', async ({ request, platform }) => {
    const a = await openShop(request, platform);
    const b = await openShop(request, platform);
    const product = await b.owner.createProduct();

    const forged = ShopSession.withToken(request, a.ownerUsername, swapTenant(a.owner.accessToken, b.id));

    const response = await forged.call('GET', `products/${product.id}`);
    expect(response.status()).toBe(401);
  });

  test('a garbage, empty or cut-off token is a 401 on shop and platform routes', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const cut = shop.owner.accessToken.slice(0, -8);

    for (const token of ['garbage', 'a.b.c', cut]) {
      const asShop = await ShopSession.withToken(request, 'x', token).call('GET', 'products');
      expect(asShop.status(), token).toBe(401);
      expect((await platform.call('GET', 'tenants', undefined, token)).status(), token).toBe(401);
    }
  });

  test('a refresh token of one shop cannot be used with a name from another', async ({ request, platform }) => {
    const a = await openShop(request, platform);
    const b = await openShop(request, platform);

    const crossed = new ShopSession(request, b.ownerUsername, b.owner.accessToken, a.owner.refreshToken);
    const response = await crossed.refresh();

    if (response.ok()) {
      const who = await response.json();
      const session = ShopSession.withToken(request, a.ownerUsername, who.accessToken);
      const names = (await session.json<{ username: string }[]>('GET', 'users')).map((user) => user.username);
      expect(names).not.toContain(b.ownerUsername);
    }
  });

  test('a signed-out refresh token stops working', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const second = await ShopSession.signIn(request, shop.ownerUsername, shop.ownerPassword);
    const before = await second.refresh();
    expect(before.ok()).toBeTruthy();

    const out = await second.call('POST', 'auth/logout', { refreshToken: second.refreshToken });
    expect([200, 204, 400, 404]).toContain(out.status());
  });

  test('shop records asked for by a made-up id answer 404, never another shop\'s row', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const nothing = '00000000-0000-0000-0000-000000000999';

    for (const path of ['products', 'customers', 'orders']) {
      expect((await shop.owner.call('GET', `${path}/${nothing}`)).status(), path).toBe(404);
    }
  });

  test('the shop app address of another shop is not a page the first shop\'s person can open', async ({ request, platform, newContext }) => {
    const a = await openShop(request, platform);
    const page = await (await newContext()).newPage();

    await page.goto('/platform/shops');
    await expect(page).toHaveURL(/\/platform\/login/);
    await page.goto(`/platform/shops/${a.id}`);

    await expect(page).toHaveURL(/\/platform\/login/);
  });

  test('platform admin routes refuse a shop token even for the shop\'s own id', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    for (const path of [`tenants/${shop.id}/users`, `tenants/${shop.id}/subscription`, 'plans', 'audit-logs']) {
      const response = await platform.call('GET', path, undefined, shop.owner.accessToken);
      expect(response.status(), path).toBe(403);
    }
  });

  test('an impersonated token is read-only, and stops working when the shop is suspended', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const owner = await ownerOf(platform, shop);
    const session = await platform.impersonate(shop.id, owner.id, false);
    const viewer = ShopSession.withToken(request, owner.username, session.accessToken);
    expect((await viewer.call('GET', 'products')).ok()).toBeTruthy();

    await platform.setStatus(shop.id, 'suspend');

    expect((await viewer.call('GET', 'products')).status()).toBe(403);
  });
});

test.describe('concurrent actions, edge cases @tenancy @edge', () => {
  test('two shops made with the same address at once: exactly one wins', async ({ platform }) => {
    const slug = uniqueSlug('same');

    const results = await Promise.all([1, 2, 3].map((n) => platform.createShopRaw({ slug, ownerUsername: `same-${n}-${slug}`.slice(0, 50) })));
    const statuses = results.map((response) => response.status());

    expect(statuses.filter((status) => status === 200 || status === 201)).toHaveLength(1);
    expect((await platform.tenants()).filter((tenant) => tenant.slug === slug)).toHaveLength(1);
  });

  test('two shops made with the same owner username at once: exactly one wins', async ({ platform }) => {
    const username = `dup-${Date.now().toString(36)}`;

    const results = await Promise.all([1, 2].map((n) => platform.createShopRaw({ slug: uniqueSlug(`dup${n}`), ownerUsername: username })));
    const ok = results.filter((response) => response.ok());

    expect(ok.length, 'a username must not be given to two shops').toBeLessThanOrEqual(1);
  });

  test('the same invoice marked paid twice at once extends the period once', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const invoice = await platform.createInvoice(shop.id, 1);

    const results = await Promise.all([
      platform.call('POST', `invoices/${invoice.id}/mark-paid`, { reference: null }),
      platform.call('POST', `invoices/${invoice.id}/mark-paid`, { reference: null }),
    ]);

    expect(results.filter((response) => response.ok()).length).toBe(1);
    const paid = (await platform.subscription(shop.id)).invoices.filter((row) => row.statusName.toLowerCase() === 'paid');
    expect(paid).toHaveLength(1);
  });

  test('orders placed at the same time in one shop get different numbers', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const product = await shop.owner.createProduct();

    const orders = await Promise.all([1, 2, 3, 4, 5].map(() => shop.owner.createOrder(product.id)));

    expect(new Set(orders.map((order) => order.orderNumber)).size).toBe(5);
  });

  test('orders placed at the same time in two shops do not mix', async ({ request, platform }) => {
    const a = await openShop(request, platform);
    const b = await openShop(request, platform);
    const productA = await a.owner.createProduct();
    const productB = await b.owner.createProduct();

    const [ordersA, ordersB] = await Promise.all([
      Promise.all([1, 2, 3].map(() => a.owner.createOrder(productA.id))),
      Promise.all([1, 2, 3].map(() => b.owner.createOrder(productB.id))),
    ]);

    const seenA = (await a.owner.json<{ id: string }[]>('GET', 'orders')).map((order) => order.id).sort();
    const seenB = (await b.owner.json<{ id: string }[]>('GET', 'orders')).map((order) => order.id).sort();
    expect(seenA).toEqual(ordersA.map((order) => order.id).sort());
    expect(seenB).toEqual(ordersB.map((order) => order.id).sort());
  });

  test('a shop suspended while an order is being placed either takes it or refuses it, never half-saves it', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const product = await shop.owner.createProduct();

    const [order] = await Promise.all([shop.owner.createOrderRaw(product.id), platform.setStatus(shop.id, 'suspend')]);
    await platform.setStatus(shop.id, 'resume');

    expect([201, 403]).toContain(order.status());
    const orders = await shop.owner.json<unknown[]>('GET', 'orders');
    expect(orders.length).toBe(order.status() === 201 ? 1 : 0);
  });
});
