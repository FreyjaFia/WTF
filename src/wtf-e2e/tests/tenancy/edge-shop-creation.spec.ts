import { expect, test } from '@fixtures/index';
import { ShopSession } from '@api/shop-session';
import { TENANT_STATUS, uniqueSlug } from '@api/platform';
import { testPassword } from '@data/env';
import { USERNAMES } from '@data/users';
import { unique } from '@utils/unique';
import { openShop } from '@utils/tenants';

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const slug = uniqueSlug('edge');
  return {
    name: unique('Edge Shop'),
    slug,
    ownerFirstName: 'Edge',
    ownerLastName: 'Owner',
    ownerUsername: `own-${slug}`.slice(0, 50),
    ...overrides,
  };
}

test.describe('shop addresses and owner names, edge cases @tenancy @edge @platform', () => {
  for (const [label, slug] of [
    ['two characters', 'ab'],
    ['starting with a dash', '-bad-start'],
    ['ending with a dash', 'bad-end-'],
    ['with a space', 'has space'],
    ['with an underscore', 'has_underscore'],
    ['with a dot', 'has.dot'],
    ['with an accent', 'café-shop'],
    ['51 characters', 'a'.repeat(51)],
    ['empty', ''],
  ] as const) {
    test(`refuses a shop address ${label}`, async ({ platform }) => {
      const response = await platform.call('POST', 'tenants', body({ slug }));

      expect(response.status()).toBe(400);
    });
  }

  test('accepts the shortest valid shop address and one of 36 characters', async ({ platform }) => {
    const short = Date.now().toString(36).slice(-3);
    const long = `l${'0'.repeat(30)}${Date.now().toString(36)}`.slice(0, 36);

    for (const slug of [short, long]) {
      const response = await platform.call('POST', 'tenants', body({ slug }));
      expect(response.ok(), `${slug}: ${await response.text()}`).toBeTruthy();
    }
  });

  // Known app bug: the address is allowed up to 50 characters, but the shop's customer-link account is named
  // "customer-link.<address>" in a 50 character column, so an address over 36 characters fails with a 500.
  test.fail('accepts a shop address of the full 50 characters', async ({ platform }) => {
    const slug = `l${'0'.repeat(30)}${Date.now().toString(36)}`.slice(0, 50);

    const response = await platform.call('POST', 'tenants', body({ slug }));

    expect(response.ok(), `${slug}: ${response.status()}`).toBeTruthy();
  });

  for (const slug of ['www', 'api', 'app', 'admin', 'platform', 'shop', 'static', 'mail', 'support', 'login', 'wtf', 'test', 'demo', 'staging']) {
    test(`refuses the reserved shop address "${slug}"`, async ({ platform }) => {
      const response = await platform.call('POST', 'tenants', body({ slug }));

      expect(response.status()).toBe(400);
      expect(await response.text()).toMatch(/reserved|already taken/i);
    });
  }

  test('lower-cases and trims the shop address, and then refuses the same address in capitals', async ({ platform }) => {
    const slug = uniqueSlug('case');

    // Shops made at the same moment can hit the known duplicate-key bug, so that answer is retried.
    let first = await platform.call('POST', 'tenants', body({ slug: `  ${slug.toUpperCase()}  ` }));
    for (let attempt = 0; attempt < 5 && first.status() === 500; attempt++) {
      first = await platform.call('POST', 'tenants', body({ slug: `  ${slug.toUpperCase()}  ` }));
    }
    expect(first.ok(), await first.text()).toBeTruthy();
    expect((await first.json()).tenant.slug).toBe(slug);

    const again = await platform.call('POST', 'tenants', body({ slug }));
    expect(again.status()).toBe(400);
    expect(await again.text()).toContain('already taken');
  });

  test('keeps the address of a cancelled shop taken', async ({ platform }) => {
    const created = await platform.createShop();
    await platform.setStatus(created.tenant.id, 'cancel');

    const response = await platform.call('POST', 'tenants', body({ slug: created.tenant.slug }));

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('already taken');
  });

  test('refuses a missing or oversized shop name, owner name or username', async ({ platform }) => {
    const cases: Record<string, unknown>[] = [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { ownerFirstName: '' },
      { ownerLastName: '' },
      { ownerFirstName: 'x'.repeat(51) },
      { ownerLastName: 'x'.repeat(51) },
      { ownerUsername: '' },
      { ownerUsername: 'u'.repeat(51) },
    ];

    for (const overrides of cases) {
      const response = await platform.call('POST', 'tenants', body(overrides));
      expect(response.status(), JSON.stringify(overrides).slice(0, 60)).toBe(400);
    }
  });

  test('accepts a shop name of exactly 100 characters', async ({ platform }) => {
    const response = await platform.call('POST', 'tenants', body({ name: 'n'.repeat(100) }));

    expect(response.ok(), await response.text()).toBeTruthy();
  });

  test('refuses an owner username that any shop already uses, in any letter case', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    for (const username of [shop.ownerUsername, shop.ownerUsername.toUpperCase(), USERNAMES.admin, USERNAMES.admin.toUpperCase(), 'superadmin']) {
      const response = await platform.call('POST', 'tenants', body({ ownerUsername: username }));
      expect(response.status(), username).toBe(400);
      expect(await response.text()).toContain('Username already exists');
    }
  });

  test('refuses an owner username that is another shop\'s customer-link system account', async ({ platform }) => {
    const created = await platform.createShop();

    const response = await platform.call('POST', 'tenants', body({ ownerUsername: `customer-link.${created.tenant.slug}` }));

    expect(response.status()).toBe(400);
  });

  test('trims the owner username and keeps the case it was given', async ({ request, platform }) => {
    const slug = uniqueSlug('trim');
    const username = `Owner-${Date.now().toString(36)}`;

    const response = await platform.call('POST', 'tenants', body({ slug, ownerUsername: `  ${username}  ` }));
    expect(response.ok(), await response.text()).toBeTruthy();
    const created = await response.json();

    expect(created.ownerUsername).toBe(username);
    const owner = await ShopSession.signIn(request, username, created.temporaryPassword);
    expect((await owner.call('GET', 'products')).ok()).toBeTruthy();
  });

  test('refuses an unknown plan code and leaves no half-made shop behind', async ({ platform }) => {
    const slug = uniqueSlug('noplan');

    const response = await platform.call('POST', 'tenants', body({ slug, planCode: 'platinum' }));

    expect(response.status()).toBe(400);
    expect((await platform.tenants()).map((tenant) => tenant.slug)).not.toContain(slug);
  });

  test('starts a trial shop on the trial status, usable at once, and a paid invoice turns it active', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { isTrial: true });
    expect(shop.created.tenant.status).toBe(TENANT_STATUS.Trial);
    const product = await shop.owner.createProduct();
    expect((await shop.owner.createOrderRaw(product.id)).ok()).toBeTruthy();

    const invoice = await platform.createInvoice(shop.id, 1);
    await platform.markPaid(invoice.id);

    const tenant = (await platform.tenants()).find((row) => row.id === shop.id);
    expect(tenant?.status).toBe(TENANT_STATUS.Active);
  });

  test('picks the shop plan by code when one is given', async ({ platform }) => {
    const created = await platform.createShop({ planCode: 'starter' });

    const subscription = await platform.json<{ planName: string }>('GET', `tenants/${created.tenant.id}/subscription`);

    expect(subscription.planName).toBe('Starter');
  });

  test('gives every new shop its own starter catalog and no products, customers or stock', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    const catalog = await shop.owner.json<{ categories: unknown[] }>('GET', 'catalog');
    expect(catalog.categories.length).toBeGreaterThan(0);
    expect(await shop.owner.json<unknown[]>('GET', 'products')).toHaveLength(0);
    expect(await shop.owner.json<unknown[]>('GET', 'customers')).toHaveLength(0);
    expect(await shop.owner.json<unknown[]>('GET', 'items')).toHaveLength(0);
  });

  test('a new shop starts with an empty dashboard and reports that still load', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const today = new Date().toISOString().slice(0, 10);

    for (const path of ['dashboard', `reports/daily-sales?fromDate=${today}&toDate=${today}`, `reports/profit-loss?fromDate=${today}&toDate=${today}`, 'audit-logs', 'notifications']) {
      const response = await shop.owner.call('GET', path);
      expect(response.ok(), `${path} -> ${response.status()}`).toBeTruthy();
    }
  });

  test('refuses a shop whose password the owner never sets: the one-time password differs per shop', async ({ platform }) => {
    const a = await platform.createShop();
    const b = await platform.createShop();

    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
    expect(a.temporaryPassword).not.toBe(testPassword());
  });
});
