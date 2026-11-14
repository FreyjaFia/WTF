import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { API_ORIGIN, PLATFORM_USERNAME, TIME_ZONE, testPassword } from '@data/env';
import { unique } from '@utils/unique';

export const TENANT_STATUS = { Trial: 1, Active: 2, Suspended: 3, Cancelled: 4 } as const;

export interface PlatformTenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: number;
  readonly statusName: string;
  readonly userCount: number;
  readonly orderCount: number;
  readonly planName?: string | null;
}

export interface CreatedShop {
  readonly tenant: PlatformTenant;
  readonly ownerUsername: string;
  readonly temporaryPassword: string;
}

export interface PlatformUser {
  readonly id: string;
  readonly username: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: string;
  readonly isActive: boolean;
}

export interface PlatformPlan {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly monthlyPrice: number;
  readonly features: readonly string[];
  readonly maxUsers: number | null;
  readonly isActive: boolean;
}

export interface PlatformInvoice {
  readonly id: string;
  readonly status: number;
  readonly statusName: string;
  readonly months: number;
  readonly amount: number;
  readonly reference?: string | null;
  readonly periodEnd: string;
}

export interface TenantSubscription {
  readonly tenantId: string;
  readonly planId: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly graceDays: number;
  readonly warning: string;
  readonly invoices: readonly PlatformInvoice[];
}

export interface AuditEntry {
  readonly username: string | null;
  readonly action: string;
  readonly tenantId: string | null;
  readonly details: string | null;
}

export interface ShopInput {
  readonly name?: string;
  readonly slug?: string;
  readonly ownerUsername?: string;
  readonly isTrial?: boolean;
  readonly planCode?: string;
}

export interface Impersonation {
  readonly accessToken: string;
  readonly username: string;
  readonly tenantName: string;
  readonly readOnly: boolean;
}

function asUtc(value: string): Date {
  return new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
}

type Verb = 'GET' | 'POST' | 'PUT';

// A valid shop address (3 to 50 lowercase letters, numbers and dashes) that is never one of the reserved words.
export function uniqueSlug(prefix: string = 'e2e-shop'): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.toLowerCase();
}

export class PlatformApi {
  private static cached: { value: string; takenAt: number } | null = null;

  public constructor(private readonly request: APIRequestContext) {}

  public async token(): Promise<string> {
    const cached = PlatformApi.cached;
    if (cached && Date.now() - cached.takenAt < 30 * 60_000) {
      return cached.value;
    }

    const response = await this.login(PLATFORM_USERNAME, testPassword());
    expect(response.ok(), `platform login -> ${response.status()}`).toBeTruthy();
    const value: string = (await response.json()).accessToken;
    PlatformApi.cached = { value, takenAt: Date.now() };
    return value;
  }

  public async login(username: string, password: string): Promise<APIResponse> {
    return this.request.post(`${API_ORIGIN}/api/platform/auth/login`, { data: { username, password } });
  }

  public async call(method: Verb, path: string, body?: unknown, token?: string | null): Promise<APIResponse> {
    const bearer = token === undefined ? await this.token() : token;
    const headers: Record<string, string> = { 'X-TimeZone': TIME_ZONE };
    if (bearer) {
      headers.Authorization = `Bearer ${bearer}`;
    }

    return this.request.fetch(`${API_ORIGIN}/api/platform/${path.replace(/^\//, '')}`, { method, headers, data: body });
  }

  public async json<T>(method: Verb, path: string, body?: unknown): Promise<T> {
    const response = await this.call(method, path, body);
    const text = await response.text();
    expect(response.ok(), `${method} platform/${path} -> ${response.status()} ${text}`).toBeTruthy();
    return (text ? JSON.parse(text) : null) as T;
  }

  public async createShopRaw(input: ShopInput = {}): Promise<APIResponse> {
    const slug = input.slug ?? uniqueSlug();
    return this.call('POST', 'tenants', {
      name: input.name ?? unique('E2E Shop'),
      slug,
      ownerFirstName: 'Owner',
      ownerLastName: 'E2E',
      ownerUsername: input.ownerUsername ?? `owner-${slug}`.slice(0, 50),
      isTrial: input.isTrial ?? false,
      planCode: input.planCode ?? 'business',
    });
  }

  // Shops created at the same moment can collide on the catalog ids they copy (known app bug, see the test marked
  // test.fail in platform-shops.spec.ts), so a duplicate-key answer is retried a few times.
  public async createShop(input: ShopInput = {}): Promise<CreatedShop> {
    const slug = input.slug ?? uniqueSlug();
    const withSlug = { ...input, slug };
    for (let attempt = 1; ; attempt++) {
      const response = await this.createShopRaw(withSlug);
      const text = await response.text();
      if (response.status() === 500 && text.includes('duplicate key') && attempt < 6) {
        continue;
      }

      expect(response.ok(), `POST platform/tenants -> ${response.status()} ${text.slice(0, 400)}`).toBeTruthy();
      return JSON.parse(text) as CreatedShop;
    }
  }

  public async tenants(): Promise<readonly PlatformTenant[]> {
    return this.json<readonly PlatformTenant[]>('GET', 'tenants');
  }

  public async setStatus(id: string, change: 'suspend' | 'resume' | 'cancel', reason: string = 'E2E'): Promise<PlatformTenant> {
    return this.json<PlatformTenant>('POST', `tenants/${id}/${change}`, { reason });
  }

  public async users(id: string): Promise<readonly PlatformUser[]> {
    return this.json<readonly PlatformUser[]>('GET', `tenants/${id}/users`);
  }

  public async resetPassword(id: string, userId: string): Promise<{ username: string; temporaryPassword: string }> {
    return this.json('POST', `tenants/${id}/users/${userId}/reset-password`);
  }

  public async impersonate(id: string, userId: string, allowWrites: boolean = false, reason: string = 'E2E support check'): Promise<Impersonation> {
    return this.json<Impersonation>('POST', `tenants/${id}/users/${userId}/impersonate`, { reason, allowWrites });
  }

  public async plans(): Promise<readonly PlatformPlan[]> {
    return this.json<readonly PlatformPlan[]>('GET', 'plans');
  }

  public async subscription(id: string): Promise<TenantSubscription> {
    return this.json<TenantSubscription>('GET', `tenants/${id}/subscription`);
  }

  public async setSubscription(
    id: string,
    changes: { planId?: number; periodEnd?: string | null; graceDays?: number; discountPercent?: number; notes?: string | null },
  ): Promise<TenantSubscription> {
    const current = await this.subscription(id);
    return this.json<TenantSubscription>('PUT', `tenants/${id}/subscription`, {
      planId: changes.planId ?? current.planId,
      periodEnd: changes.periodEnd ?? null,
      graceDays: changes.graceDays ?? current.graceDays,
      discountPercent: changes.discountPercent ?? 0,
      notes: changes.notes ?? null,
    });
  }

  // Ends the paid period and its grace days a millisecond after it started (a period must end after it starts), so the shop is
  // lapsed at once: reads still work, writes get 402.
  public async lapse(id: string): Promise<void> {
    const current = await this.subscription(id);
    const periodEnd = new Date(asUtc(current.periodStart).getTime() + 1).toISOString();
    await this.setSubscription(id, { periodEnd, graceDays: 0 });
  }

  public async createInvoice(id: string, months: number = 1, reference: string | null = null): Promise<PlatformInvoice> {
    return this.json<PlatformInvoice>('POST', `tenants/${id}/invoices`, { months, reference, dueDate: null, notes: null });
  }

  public async markPaid(invoiceId: string, reference: string | null = null): Promise<PlatformInvoice> {
    return this.json<PlatformInvoice>('POST', `invoices/${invoiceId}/mark-paid`, { reference });
  }

  public async voidInvoice(invoiceId: string): Promise<PlatformInvoice> {
    return this.json<PlatformInvoice>('POST', `invoices/${invoiceId}/void`);
  }

  public async auditLog(tenantId: string | null = null, take: number = 200): Promise<readonly AuditEntry[]> {
    const query = tenantId ? `?tenantId=${tenantId}&take=${take}` : `?take=${take}`;
    return this.json<readonly AuditEntry[]>('GET', `audit-logs${query}`);
  }
}
