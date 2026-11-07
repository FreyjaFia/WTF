import { beforeEach, describe, expect, it } from 'vitest';
import {
  currentTenantId,
  DEFAULT_TENANT_ID,
  readDeviceTenantId,
  saveDeviceTenantId,
  tenantIdFromToken,
  tenantOfQueuedOrder,
} from './tenant-context';

function tokenWith(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${body}.signature`;
}

describe('tenant context', () => {
  beforeEach(() => localStorage.clear());

  it('reads the tenant from the token', () => {
    expect(tenantIdFromToken(tokenWith({ tenant_id: 'AAAAAAAA-0000-0000-0000-000000000001' }))).toBe(
      'aaaaaaaa-0000-0000-0000-000000000001',
    );
  });

  it('treats a token without the claim, a broken token and no token as the first tenant', () => {
    expect(tenantIdFromToken(tokenWith({ sub: 'x' }))).toBe(DEFAULT_TENANT_ID);
    expect(tenantIdFromToken('not-a-token')).toBe(DEFAULT_TENANT_ID);
    expect(tenantIdFromToken(null)).toBe(DEFAULT_TENANT_ID);
  });

  it('uses the stored token for the current tenant', () => {
    localStorage.setItem('token', tokenWith({ tenant_id: 'bbbbbbbb-0000-0000-0000-000000000002' }));

    expect(currentTenantId()).toBe('bbbbbbbb-0000-0000-0000-000000000002');
  });

  it('remembers the tenant of the device', () => {
    expect(readDeviceTenantId()).toBeNull();

    saveDeviceTenantId('bbbbbbbb-0000-0000-0000-000000000002');

    expect(readDeviceTenantId()).toBe('bbbbbbbb-0000-0000-0000-000000000002');
  });

  it('gives a queued order without a tenant to the first tenant', () => {
    expect(tenantOfQueuedOrder({})).toBe(DEFAULT_TENANT_ID);
    expect(tenantOfQueuedOrder({ tenantId: 'AAAA' })).toBe('aaaa');
  });
});
