import { ApiClient } from '@api/client';
import { testPassword } from '@data/env';
import { ROLE_IDS } from '@data/users';
import { unique, uniqueUsername } from '@utils/unique';

export interface User {
  readonly id: string;
  readonly username: string;
  readonly isActive: boolean;
}

export class UsersApi {
  public constructor(private readonly api: ApiClient) {}

  public async create(roleId: number = ROLE_IDS.Cashier): Promise<User> {
    return this.api.json<User>('superadmin', 'POST', 'users', {
      firstName: unique('User'),
      lastName: 'E2E',
      username: uniqueUsername(),
      password: testPassword(),
      roleId,
    });
  }

  public async remove(id: string): Promise<void> {
    await this.api.json<unknown>('superadmin', 'DELETE', `users/${id}`);
  }
}

