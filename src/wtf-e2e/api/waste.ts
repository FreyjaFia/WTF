import { APIResponse } from '@playwright/test';
import { ApiClient } from '@api/client';
import { WasteReason, WasteSource } from '@data/enums';
import { Role } from '@data/users';

export interface WasteInput {
  readonly quantity: number;
  readonly wasteReasonId?: number;
  readonly notes?: string | null;
  readonly source?: number;
}

export interface WasteRecord {
  readonly id: string;
  readonly status: string;
  readonly itemId?: string;
}

export interface WastePage {
  readonly items: readonly WasteRecord[];
  readonly totalCount: number;
}

export interface WasteReasonRecord {
  readonly id: number;
  readonly name: string;
  readonly isActive: boolean;
  readonly isSystem?: boolean;
}

export class WasteApi {
  public constructor(private readonly api: ApiClient) {}

  public async recordRaw(itemId: string, input: WasteInput, role: Role = 'superadmin'): Promise<APIResponse> {
    return this.api.call(role, 'POST', `items/${itemId}/stock/waste`, {
      body: {
        quantity: input.quantity,
        wasteReasonId: input.wasteReasonId ?? WasteReason.SpilledOrDropped,
        notes: input.notes ?? null,
        source: input.source ?? WasteSource.Inventory,
        clientRequestId: crypto.randomUUID(),
      },
    });
  }

  public async record(itemId: string, input: WasteInput, role: Role = 'superadmin'): Promise<WasteRecord> {
    return ApiClient.parse<WasteRecord>(await this.recordRaw(itemId, input, role), 'record waste');
  }

  public async list(query: string): Promise<WastePage> {
    return this.api.json<WastePage>('superadmin', 'GET', `stock-waste?${query}`);
  }

  public async review(id: string, action: 'confirm' | 'dispute' | 'reverse', note: string | null = null, role: Role = 'admin'): Promise<APIResponse> {
    return this.api.call(role, 'POST', `stock-waste/${id}/${action}`, { body: action === 'reverse' ? { reason: note } : { note } });
  }

  public async reasons(): Promise<readonly WasteReasonRecord[]> {
    return this.api.json<readonly WasteReasonRecord[]>('superadmin', 'GET', 'waste-reasons?includeInactive=true');
  }

  public async createReason(name: string, requiresNote: boolean = false): Promise<WasteReasonRecord> {
    return this.api.json<WasteReasonRecord>('admin', 'POST', 'waste-reasons', { name, requiresNote, sortOrder: 50 });
  }
}
