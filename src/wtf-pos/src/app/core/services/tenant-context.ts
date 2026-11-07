export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const DEVICE_TENANT_KEY = 'wtf-device-tenant';

export function tenantIdFromToken(token: string | null): string {
  if (!token) {
    return DEFAULT_TENANT_ID;
  }

  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
    const claim = payload['tenant_id'];

    // Tokens issued before tenants existed have no claim: they belong to the first tenant.
    return typeof claim === 'string' && claim ? claim.toLowerCase() : DEFAULT_TENANT_ID;
  } catch {
    return DEFAULT_TENANT_ID;
  }
}

export function currentTenantId(): string {
  return tenantIdFromToken(localStorage.getItem('token'));
}

export function readDeviceTenantId(): string | null {
  return localStorage.getItem(DEVICE_TENANT_KEY);
}

export function saveDeviceTenantId(tenantId: string): void {
  localStorage.setItem(DEVICE_TENANT_KEY, tenantId);
}

export function tenantOfQueuedOrder(order: { tenantId?: string }): string {
  return (order.tenantId ?? DEFAULT_TENANT_ID).toLowerCase();
}
