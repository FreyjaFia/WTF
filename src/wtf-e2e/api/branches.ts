import { APIResponse } from '@playwright/test';
import { ApiClient } from '@api/client';
import { Role } from '@data/users';
import { unique } from '@utils/unique';

export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly isActive: boolean;
  readonly isMain: boolean;
}

export class BranchesApi {
  public constructor(private readonly api: ApiClient) {}

  public async create(code: string, name: string = unique('Branch')): Promise<Branch> {
    return this.api.json<Branch>('owner', 'POST', 'branches', { name, code, address: '12 Rizal Avenue, Manila', phone: null });
  }

  public async list(role: Role = 'owner'): Promise<readonly Branch[]> {
    return this.api.json<readonly Branch[]>(role, 'GET', 'branches');
  }

  public async main(): Promise<Branch> {
    return (await this.list()).find((branch) => branch.isMain)!;
  }

  public async close(id: string): Promise<APIResponse> {
    return this.api.call('owner', 'POST', `branches/${id}/close`, { body: { moveStaffToBranchId: null } });
  }

  public async closeQuietly(id: string): Promise<void> {
    await this.close(id);
  }
}
