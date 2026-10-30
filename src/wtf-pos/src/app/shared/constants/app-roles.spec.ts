import { describe, expect, it } from 'vitest';
import { AppRoleGroups, AppRoleLabels, AppRoles } from './app-roles';

describe('app roles', () => {
  const roles = Object.values(AppRoles);

  it('has a human-readable label for every role', () => {
    for (const role of roles) {
      expect(AppRoleLabels[role]).toBeTruthy();
    }
    expect(Object.keys(AppRoleLabels).sort()).toEqual([...roles].sort());
  });

  it('only references known roles in groups, without duplicates', () => {
    for (const [group, members] of Object.entries(AppRoleGroups)) {
      const list = members as readonly string[];
      expect(list.length, group).toBeGreaterThan(0);
      expect(new Set(list).size, group).toBe(list.length);
      for (const role of list) {
        expect(roles, group).toContain(role);
      }
    }
  });

  it('always lets SuperAdmin do everything', () => {
    for (const [group, members] of Object.entries(AppRoleGroups)) {
      expect(members as readonly string[], group).toContain(AppRoles.SuperAdmin);
    }
  });

  it('keeps each write group within its read group', () => {
    const pairs: [keyof typeof AppRoleGroups, keyof typeof AppRoleGroups][] = [
      ['ProductsWrite', 'ProductsRead'],
      ['UsersWrite', 'UsersRead'],
      ['PromotionsWrite', 'PromotionsRead'],
      ['OrdersWrite', 'OrdersRead'],
      ['ItemsWrite', 'ItemsRead'],
      ['StockMovementsWrite', 'StockMovementsRead'],
    ];

    for (const [write, read] of pairs) {
      for (const role of AppRoleGroups[write] as readonly string[]) {
        expect(AppRoleGroups[read] as readonly string[], `${write} -> ${read}`).toContain(role);
      }
    }
  });

  it('gives AdminViewer read access but no write access', () => {
    for (const [group, members] of Object.entries(AppRoleGroups)) {
      if (group.endsWith('Write') || group === 'OrdersOverride') {
        expect(members as readonly string[], group).not.toContain(AppRoles.AdminViewer);
      }
    }
  });
});

describe('app roles vs the API policies', () => {
  // Mirrors WTF.Api AppAuthorizationExtensions (and the .NET PolicyMatrixTests). Update both together.
  const apiPolicies: Record<Exclude<keyof typeof AppRoleGroups, 'ManagementAccess'>, readonly string[]> = {
    DashboardRead: ['SuperAdmin', 'Admin', 'AdminViewer'],
    ProductsRead: ['SuperAdmin', 'Admin', 'AdminViewer', 'Cashier'],
    ProductsWrite: ['SuperAdmin', 'Admin'],
    UsersRead: ['SuperAdmin', 'Admin', 'AdminViewer'],
    UsersWrite: ['SuperAdmin', 'Admin'],
    PromotionsRead: ['SuperAdmin', 'Admin', 'AdminViewer'],
    PromotionsWrite: ['SuperAdmin', 'Admin'],
    ReportsRead: ['SuperAdmin', 'Admin', 'AdminViewer'],
    ReportsGenerate: ['SuperAdmin', 'Admin'],
    AuditRead: ['SuperAdmin'],
    SchemaScriptHistoryRead: ['SuperAdmin'],
    OrdersRead: ['SuperAdmin', 'Admin', 'AdminViewer', 'Cashier'],
    OrdersWrite: ['SuperAdmin', 'Admin', 'Cashier'],
    OrdersOverride: ['SuperAdmin', 'Admin'],
    OrderLinksWrite: ['SuperAdmin', 'Admin', 'Cashier'],
    CustomersRead: ['SuperAdmin', 'Admin', 'AdminViewer', 'Cashier'],
    CustomersWrite: ['SuperAdmin', 'Admin', 'Cashier'],
    ItemsRead: ['SuperAdmin', 'Admin', 'AdminViewer', 'ItemManager', 'StockManager'],
    ItemsWrite: ['SuperAdmin', 'Admin', 'ItemManager'],
    InventoryCostsRead: ['SuperAdmin', 'Admin', 'AdminViewer'],
    StockMovementsRead: ['SuperAdmin', 'Admin', 'AdminViewer', 'StockManager'],
    StockMovementsWrite: ['SuperAdmin', 'Admin', 'StockManager'],
    StockWasteWrite: ['SuperAdmin', 'Admin', 'StockManager', 'Cashier'],
    StockWasteReview: ['SuperAdmin', 'Admin'],
    WasteReasonsManage: ['SuperAdmin', 'Admin'],
    WasteReasonsRead: ['SuperAdmin', 'Admin', 'AdminViewer', 'StockManager', 'Cashier'],
  };

  // UI-only groups have no API policy because the API has no matching area to protect.
  const uiOnlyGroups = ['ManagementAccess'];

  it('has an API policy for every UI group except the UI-only ones', () => {
    const apiBacked = Object.keys(AppRoleGroups).filter((g) => !uiOnlyGroups.includes(g));
    expect(apiBacked.sort()).toEqual(Object.keys(apiPolicies).sort());
  });

  it('never grants the UI to a role the API would deny', () => {
    for (const [group, roles] of Object.entries(AppRoleGroups)) {
      if (uiOnlyGroups.includes(group)) {
        continue;
      }
      const allowedByApi = apiPolicies[group as keyof typeof apiPolicies];
      for (const role of roles as readonly string[]) {
        expect(allowedByApi, `${group} grants ${role} but the API does not`).toContain(role);
      }
    }
  });

  it('keeps Cashier out of the management read groups the API opens to it', () => {
    // Cashiers can write customers (register one on the new order page) and the API lets them read
    // customers for the order editor, but they get no customer or product management screens.
    expect(AppRoleGroups.ProductsRead as readonly string[]).not.toContain(AppRoles.Cashier);
    expect(AppRoleGroups.CustomersRead as readonly string[]).not.toContain(AppRoles.Cashier);
    expect(apiPolicies.ProductsRead).toContain(AppRoles.Cashier);
    expect(apiPolicies.CustomersRead).toContain(AppRoles.Cashier);
  });
});
