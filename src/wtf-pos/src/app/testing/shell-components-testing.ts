import { signal } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { vi } from 'vitest';

export interface FakeMe {
  firstName: string;
  lastName: string;
  imageUrl?: string | null;
}

/** Fakes for the services consumed by the header and sidebar shell components. */
export function createShellFakes(me: Observable<FakeMe> = of({ firstName: 'Jane', lastName: 'Doe' })) {
  const meRefresh$ = new Subject<void>();
  const permissions: Record<string, boolean> = {};
  const can = (name: string) => () => permissions[name] ?? true;

  const auth = {
    meRefresh$: meRefresh$.asObservable(),
    getMe: vi.fn(() => me),
    getCurrentRoleLabel: vi.fn(() => 'Admin'),
    logout: vi.fn(),
    canAccessAuditLogs: can('canAccessAuditLogs'),
    canAccessReports: can('canAccessReports'),
    canAccessSchemaScriptHistory: can('canAccessSchemaScriptHistory'),
    canReadCustomers: can('canReadCustomers'),
    canReadInventory: can('canReadInventory'),
    canReadItems: can('canReadItems'),
    canReadManagement: can('canReadManagement'),
    canReadOrders: can('canReadOrders'),
    canReadProducts: can('canReadProducts'),
    canReadPromotions: can('canReadPromotions'),
    canReadStockMovements: can('canReadStockMovements'),
    canReadUsers: can('canReadUsers'),
    canWriteOrders: can('canWriteOrders'),
  };

  const imageCache = {
    cacheUrl: vi.fn().mockResolvedValue(undefined),
    resolveUrl: vi.fn((url: string) => Promise.resolve(`resolved:${url}`)),
  };

  const connectivity = { isOnline: signal(true), showReconnected: signal(false) };

  return { auth, imageCache, connectivity, meRefresh$, permissions };
}

/** Lets pending promise continuations (async subscribe handlers) run. */
export async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
