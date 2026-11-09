import { APIRequestContext } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { ShopSession } from '@api/shop-session';
import { testPassword } from '@data/env';
import { ROLE_IDS } from '@data/users';
import { openShop, TestShop } from '@utils/tenants';
import { unique, uniqueUsername } from '@utils/unique';

interface Role {
  readonly id: number;
  readonly name: string;
  readonly isSystem: boolean;
  readonly userCount: number;
  readonly permissions: ReadonlyArray<string>;
}

interface Person {
  readonly id: string;
  readonly username: string;
  readonly roleId: number;
  readonly roleName?: string | null;
}

async function createRole(session: ShopSession, name: string, permissions: ReadonlyArray<string>): Promise<Role> {
  return session.json<Role>('POST', 'roles', { name, description: 'E2E', permissions });
}

async function createUser(request: APIRequestContext, owner: ShopSession, roleId: number): Promise<{ person: Person; session: ShopSession }> {
  const username = uniqueUsername();
  const person = await owner.json<Person>('POST', 'users', {
    firstName: unique('Staff'),
    lastName: 'E2E',
    username,
    password: testPassword(),
    roleId,
  });
  const session = await ShopSession.signIn(request, username, testPassword());
  return { person, session };
}

async function status(session: ShopSession, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<number> {
  return (await session.call(method, path, body)).status();
}

test.describe('custom roles: the roles API @roles @rbac', () => {
  let shop: TestShop;

  test.beforeEach(async ({ request, platform }) => {
    shop = await openShop(request, platform);
  });

  test('the six built-in roles are listed read-only, with their permissions', async () => {
    const roles = await shop.owner.json<Role[]>('GET', 'roles');

    expect(roles.filter((role) => role.isSystem).map((role) => role.name).sort()).toEqual(
      ['Admin', 'AdminViewer', 'Cashier', 'ItemManager', 'Owner', 'StockManager'],
    );
    expect(roles.find((role) => role.name === 'Cashier')?.permissions).toContain('orders.write');
    expect(await status(shop.owner, 'PUT', `roles/${ROLE_IDS.Cashier}`, { id: ROLE_IDS.Cashier, name: 'Cashier', permissions: [] })).toBe(400);
    expect(await status(shop.owner, 'DELETE', `roles/${ROLE_IDS.Cashier}`)).toBe(400);
  });

  test('a created role keeps what its keys require, and a bad name or key is refused', async () => {
    const role = await createRole(shop.owner, unique('Lead'), ['stock.write']);
    expect([...role.permissions].sort()).toEqual(['stock.read', 'stock.write']);

    expect(await status(shop.owner, 'POST', 'roles', { name: 'Owner', permissions: [] })).toBe(400);
    expect(await status(shop.owner, 'POST', 'roles', { name: role.name.toUpperCase(), permissions: [] })).toBe(400);
    expect(await status(shop.owner, 'POST', 'roles', { name: unique('Odd'), permissions: ['made.up'] })).toBe(400);
    expect(await status(shop.owner, 'POST', 'roles', { name: '   ', permissions: [] })).toBe(400);
  });

  test('a user with a custom role can do exactly what the role allows', async ({ request }) => {
    const role = await createRole(shop.owner, unique('Bookkeeper'), ['expenses.read']);
    const { session } = await createUser(request, shop.owner, role.id);

    expect(await status(session, 'GET', 'expenses')).toBe(200);
    expect(await status(session, 'POST', 'expenses', {})).toBe(403);
    expect(await status(session, 'GET', 'users')).toBe(403);
    expect(await status(session, 'GET', 'roles')).toBe(403);
  });

  test('editing a role changes what its users can do on the next request, without signing in again', async ({ request }) => {
    const role = await createRole(shop.owner, unique('Floor'), ['orders.read']);
    const { session } = await createUser(request, shop.owner, role.id);
    expect(await status(session, 'GET', 'expenses')).toBe(403);

    await shop.owner.json<Role>('PUT', `roles/${role.id}`, { id: role.id, name: role.name, permissions: ['orders.read', 'expenses.read'] });
    expect(await status(session, 'GET', 'expenses')).toBe(200);

    await shop.owner.json<Role>('PUT', `roles/${role.id}`, { id: role.id, name: role.name, permissions: ['orders.read'] });
    expect(await status(session, 'GET', 'expenses')).toBe(403);
  });

  test('moving a user to another role takes effect on their next request', async ({ request }) => {
    const reader = await createRole(shop.owner, unique('Reader'), ['expenses.read']);
    const { person, session } = await createUser(request, shop.owner, reader.id);
    expect(await status(session, 'GET', 'expenses')).toBe(200);

    await shop.owner.json<Person>('PUT', `users/${person.id}`, {
      id: person.id, firstName: 'Staff', lastName: 'E2E', username: person.username, roleId: ROLE_IDS.ItemManager,
    });

    expect(await status(session, 'GET', 'expenses')).toBe(403);
  });

  test('a role in use cannot be deleted until its users move; an unused one can', async ({ request }) => {
    const role = await createRole(shop.owner, unique('Busy'), ['orders.read']);
    const { person } = await createUser(request, shop.owner, role.id);

    const refused = await shop.owner.call('DELETE', `roles/${role.id}`);
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain('1 user has this role');

    await shop.owner.json<Person>('PUT', `users/${person.id}`, {
      id: person.id, firstName: 'Staff', lastName: 'E2E', username: person.username, roleId: ROLE_IDS.Cashier,
    });
    expect(await status(shop.owner, 'DELETE', `roles/${role.id}`)).toBe(204);
    expect(await status(shop.owner, 'GET', `roles/${role.id}`)).toBe(404);
  });

  test('duplicating a built-in role makes an editable copy under a free name', async () => {
    const first = await shop.owner.json<Role>('POST', `roles/${ROLE_IDS.Cashier}/duplicate`);
    const second = await shop.owner.json<Role>('POST', `roles/${ROLE_IDS.Cashier}/duplicate`);

    expect(first.name).toBe('Cashier copy');
    expect(second.name).toBe('Cashier copy 2');
    expect(first.isSystem).toBe(false);
    expect([...first.permissions].sort()).toEqual([...(await shop.owner.json<Role[]>('GET', 'roles')).find((r) => r.name === 'Cashier')!.permissions].sort());
  });

  test('role changes are in the audit log', async () => {
    const role = await createRole(shop.owner, unique('Audited'), ['orders.read']);
    await shop.owner.json<Role>('PUT', `roles/${role.id}`, { id: role.id, name: role.name, permissions: ['orders.read', 'expenses.read'] });
    await shop.owner.call('DELETE', `roles/${role.id}`);

    const logs = await shop.owner.json<{ items: ReadonlyArray<{ action: string; entityType: string; entityId: string }> }>('GET', 'audit-logs?entityType=Role&pageSize=100');
    const mine = logs.items.filter((log) => log.entityType === 'Role' && log.entityId === String(role.id)).map((log) => log.action);

    expect(mine).toEqual(expect.arrayContaining(['RoleCreated', 'RoleUpdated', 'RoleDeleted']));
  });
});

test.describe('custom roles: nobody can give more than they hold @roles @rbac @security', () => {
  let shop: TestShop;

  test.beforeEach(async ({ request, platform }) => {
    shop = await openShop(request, platform);
  });

  test('a role manager can only hand out permissions they have themselves', async ({ request }) => {
    const manager = await createRole(shop.owner, unique('Role Manager'), ['roles.manage', 'users.write', 'expenses.read']);
    const { session } = await createUser(request, shop.owner, manager.id);

    expect(await status(session, 'POST', 'roles', { name: unique('Too Much'), permissions: ['expenses.write'] })).toBe(403);
    expect(await status(session, 'POST', 'roles', { name: unique('Audit'), permissions: ['audit.read'] })).toBe(403);
    const allowed = await session.json<Role>('POST', 'roles', { name: unique('Fine'), permissions: ['expenses.read'] });
    expect(allowed.permissions).toEqual(['expenses.read']);

    expect(await status(session, 'POST', `roles/${ROLE_IDS.Owner}/duplicate`)).toBe(403);
  });

  test('a role manager cannot give a user a role beyond their own, the owner role, or change their own role', async ({ request }) => {
    const manager = await createRole(shop.owner, unique('People Manager'), ['roles.manage', 'users.write', 'orders.read']);
    const richer = await createRole(shop.owner, unique('Richer'), ['orders.read', 'expenses.read']);
    const { person, session } = await createUser(request, shop.owner, manager.id);
    const target = await createUser(request, shop.owner, ROLE_IDS.Cashier);

    const move = (roleId: number) => status(session, 'PUT', `users/${target.person.id}`, {
      id: target.person.id, firstName: 'Staff', lastName: 'E2E', username: target.person.username, roleId,
    });
    expect(await move(richer.id)).toBe(403);
    expect(await move(ROLE_IDS.Owner)).toBe(403);
    expect(await move(ROLE_IDS.Admin)).toBe(403);

    expect(await status(session, 'PUT', `users/${person.id}`, {
      id: person.id, firstName: 'Staff', lastName: 'E2E', username: person.username, roleId: ROLE_IDS.Cashier,
    })).toBe(403);
  });

  test('a role manager cannot edit a role that carries permissions they lack', async ({ request }) => {
    const manager = await createRole(shop.owner, unique('Editor'), ['roles.manage', 'orders.read']);
    const heavy = await createRole(shop.owner, unique('Heavy'), ['audit.read']);
    const { session } = await createUser(request, shop.owner, manager.id);

    expect(await status(session, 'PUT', `roles/${heavy.id}`, { id: heavy.id, name: heavy.name, permissions: ['orders.read'] })).toBe(403);
    expect(await status(shop.owner, 'GET', `roles/${heavy.id}`)).toBe(200);
  });

  test('staff without roles.manage are refused every role change', async ({ request }) => {
    const admin = await createUser(request, shop.owner, ROLE_IDS.Admin);

    expect(await status(admin.session, 'GET', 'roles')).toBe(200);
    expect(await status(admin.session, 'POST', 'roles', { name: unique('Nope'), permissions: [] })).toBe(403);
    expect(await status(admin.session, 'DELETE', `roles/${ROLE_IDS.Cashier}`)).toBe(403);
  });

  test('the shop always keeps an owner', async () => {
    const me = (await shop.owner.json<Person[]>('GET', 'users')).find((u) => u.username === shop.ownerUsername)!;

    const removed = await shop.owner.call('DELETE', `users/${me.id}`);

    expect(removed.status()).toBe(400);
    expect(await removed.text()).toContain('at least one active owner');
  });
});

test.describe('custom roles: shops stay apart @roles @rbac @tenancy', () => {
  test('a custom role of one shop is invisible and unusable in another', async ({ request, platform }) => {
    const a = await openShop(request, platform);
    const b = await openShop(request, platform);
    const roleName = unique('Private');
    const role = await createRole(a.owner, roleName, ['orders.read']);

    const seenByB = await b.owner.json<Role[]>('GET', 'roles');
    expect(seenByB.map((r) => r.name)).not.toContain(roleName);
    expect(await status(b.owner, 'GET', `roles/${role.id}`)).toBe(404);
    expect(await status(b.owner, 'PUT', `roles/${role.id}`, { id: role.id, name: 'Taken', permissions: [] })).toBe(404);
    expect(await status(b.owner, 'DELETE', `roles/${role.id}`)).toBe(404);
    expect(await status(b.owner, 'POST', `roles/${role.id}/duplicate`)).toBe(404);

    const assign = await b.owner.call('POST', 'users', {
      firstName: 'Sneak', lastName: 'E2E', username: uniqueUsername(), password: testPassword(), roleId: role.id,
    });
    expect(assign.status()).toBe(400);
    expect(await assign.text()).toContain('Choose one of the listed roles');
  });

  test('two shops can each have a role with the same name', async ({ request, platform }) => {
    const a = await openShop(request, platform);
    const b = await openShop(request, platform);
    const name = unique('Same Name');

    const roleA = await createRole(a.owner, name, ['orders.read']);
    const roleB = await createRole(b.owner, name, ['expenses.read']);

    expect(roleA.id).not.toBe(roleB.id);
    expect((await a.owner.json<Role>('GET', `roles/${roleA.id}`)).permissions).toEqual(['orders.read']);
    expect((await b.owner.json<Role>('GET', `roles/${roleB.id}`)).permissions).toEqual(['expenses.read']);
  });
});
