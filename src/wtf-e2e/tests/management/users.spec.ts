import { APIResponse } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ManagementExtraApi } from '@api/management-extra';
import { testPassword } from '@data/env';
import { unique } from '@utils/unique';

const LONG_NAME: string = 'N'.repeat(101);

function mx(api: Api): ManagementExtraApi {
  return new ManagementExtraApi(api.client);
}

async function expectRejected(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), `${label}: ${await response.text()}`).toBe(400);
}

test.describe('users: create, validate, delete, restore, sign in @management', () => {
  test('a valid user is created and can sign in', async ({ api }) => {
    const body = mx(api).userBody(testPassword());

    const response = await mx(api).post('users', body);

    expect(response.status()).toBe(201);
    expect((await api.client.login(String(body.username), testPassword())).status()).toBe(200);
  });

  test('an empty username gives 400 and creates nothing', async ({ api }) => {
    const firstName = unique('NoUsername');

    const response = await mx(api).post('users', mx(api).userBody(testPassword(), { username: '', firstName }));

    await expectRejected(response, 'empty username');
    const users = await mx(api).list(`users?searchTerm=${encodeURIComponent(firstName)}`);
    expect(users).toHaveLength(0);
  });

  test('an empty password gives 400 and creates nothing', async ({ api }) => {
    const body = mx(api).userBody('', {});

    const response = await mx(api).post('users', body);

    await expectRejected(response, 'empty password');
    const users = await mx(api).list(`users?searchTerm=${encodeURIComponent(String(body.firstName))}`);
    expect(users).toHaveLength(0);
  });

  test('a duplicate username (even in another letter case) gives 400 and keeps one user', async ({ api }) => {
    const original = mx(api).userBody(testPassword());
    expect((await mx(api).post('users', original)).status()).toBe(201);

    const response = await mx(api).post('users', mx(api).userBody(testPassword(), { username: String(original.username).toUpperCase() }));

    await expectRejected(response, 'duplicate username');
    const matching = (await mx(api).list('users')).filter((user) => user.username?.toLowerCase() === String(original.username).toLowerCase());
    expect(matching).toHaveLength(1);
  });

  test('a role that does not exist gives 400 and creates nothing', async ({ api }) => {
    const body = mx(api).userBody(testPassword(), { roleId: 99 });

    const response = await mx(api).post('users', body);

    await expectRejected(response, 'unknown role');
    expect(await mx(api).list(`users?searchTerm=${encodeURIComponent(String(body.firstName))}`)).toHaveLength(0);
  });

  test('a first name of 101 characters gives 400 and creates nothing', async ({ api }) => {
    const body = mx(api).userBody(testPassword(), { firstName: LONG_NAME, lastName: unique('LongFirst') });

    const response = await mx(api).post('users', body);

    await expectRejected(response, 'long first name');
    expect(await mx(api).list(`users?searchTerm=${encodeURIComponent(String(body.lastName))}`)).toHaveLength(0);
  });

  test('editing a user saves the new name and keeps the password when none is sent', async ({ api }) => {
    const user = await api.users.create();

    const response = await mx(api).put(`users/${user.id}`, {
      id: user.id,
      firstName: 'Renamed',
      lastName: 'Person',
      username: user.username,
      password: null,
      roleId: 2,
    });

    expect(response.ok(), await response.text()).toBeTruthy();
    const saved = await api.client.json<{ firstName: string }>('superadmin', 'GET', `users/${user.id}`);
    expect(saved.firstName).toBe('Renamed');
    expect((await api.client.login(user.username, testPassword())).status()).toBe(200);
  });

  test('a deleted user is listed as inactive and cannot sign in; a restored one can', async ({ api }) => {
    const user = await api.users.create();

    await api.users.remove(user.id);
    const afterDelete = await mx(api).list('users');
    expect(afterDelete.find((u) => u.id === user.id)?.isActive).toBe(false);
    expect((await mx(api).list('users?isActive=true')).map((u) => u.id)).not.toContain(user.id);
    expect((await api.client.login(user.username, testPassword())).ok()).toBeFalsy();

    await api.client.json<unknown>('superadmin', 'POST', `users/${user.id}/restore`);
    expect((await mx(api).list('users')).find((u) => u.id === user.id)?.isActive).toBe(true);
    expect((await api.client.login(user.username, testPassword())).status()).toBe(200);
  });
});
