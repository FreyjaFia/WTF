import { describe, expect, it } from 'vitest';
import { PermissionCatalog, PolicyPermissions, SystemRolePermissions } from '@shared/permissions';
import { AppRoleGroups, AppRoleLabels, AppRoles } from './app-roles';

describe('app roles', () => {
  const roles = Object.values(AppRoles);

  it('has a human-readable label for every role', () => {
    for (const role of roles) {
      expect(AppRoleLabels[role]).toBeTruthy();
    }
    expect(Object.keys(AppRoleLabels).sort()).toEqual([...roles].sort());
  });

  it('only references known roles in the UI-only groups, without duplicates', () => {
    for (const [group, members] of Object.entries(AppRoleGroups)) {
      const list = members as readonly string[];
      expect(list.length, group).toBeGreaterThan(0);
      expect(new Set(list).size, group).toBe(list.length);
      for (const role of list) {
        expect(roles, group).toContain(role);
      }
    }
  });

  it('always lets Owner do everything', () => {
    for (const [group, members] of Object.entries(AppRoleGroups)) {
      expect(members as readonly string[], group).toContain(AppRoles.Owner);
    }
    expect(SystemRolePermissions[AppRoles.Owner].length).toBe(PermissionCatalog.length);
  });

  it('gives AdminViewer read access but no write access', () => {
    const writeKeys = PermissionCatalog.filter(
      (p) => p.key.endsWith('.write') || p.key.endsWith('.manage') || p.key === 'orders.override',
    ).map((p) => p.key);

    for (const key of SystemRolePermissions[AppRoles.AdminViewer]) {
      expect(writeKeys, key).not.toContain(key);
    }
  });
});

describe('system role permissions vs the API policies (golden)', () => {
  // The role lists the API policies used before permissions existed. Mirrors the .NET PolicyMatrixTests.
  const expectedByPolicy: Record<string, readonly string[]> = {
    DashboardRead: ['Owner', 'Admin', 'AdminViewer'],
    ProductsRead: ['Owner', 'Admin', 'AdminViewer', 'Cashier'],
    ProductsWrite: ['Owner', 'Admin'],
    UsersRead: ['Owner', 'Admin', 'AdminViewer'],
    UsersWrite: ['Owner', 'Admin'],
    PromotionsRead: ['Owner', 'Admin', 'AdminViewer'],
    PromotionsWrite: ['Owner', 'Admin'],
    ReportsRead: ['Owner', 'Admin', 'AdminViewer'],
    ReportsGenerate: ['Owner', 'Admin'],
    AuditRead: ['Owner'],
    SchemaScriptHistoryRead: ['Owner'],
    OrdersRead: ['Owner', 'Admin', 'AdminViewer', 'Cashier'],
    OrdersWrite: ['Owner', 'Admin', 'Cashier'],
    OrdersOverride: ['Owner', 'Admin'],
    OrderLinksManage: ['Owner', 'Admin', 'Cashier'],
    CustomersRead: ['Owner', 'Admin', 'AdminViewer', 'Cashier'],
    CustomersWrite: ['Owner', 'Admin', 'Cashier'],
    ItemsRead: ['Owner', 'Admin', 'AdminViewer', 'ItemManager', 'StockManager'],
    ItemsWrite: ['Owner', 'Admin', 'ItemManager'],
    InventoryCostsRead: ['Owner', 'Admin', 'AdminViewer'],
    InventoryCostsWrite: ['Owner', 'Admin'],
    StockMovementsRead: ['Owner', 'Admin', 'AdminViewer', 'StockManager'],
    StockMovementsWrite: ['Owner', 'Admin', 'StockManager'],
    StockWasteWrite: ['Owner', 'Admin', 'StockManager', 'Cashier'],
    StockWasteReview: ['Owner', 'Admin'],
    ExpensesRead: ['Owner', 'Admin', 'AdminViewer'],
    ExpensesWrite: ['Owner', 'Admin'],
    WasteReasonsManage: ['Owner', 'Admin'],
    SubscriptionBilling: ['Owner', 'Admin'],
    BrandManage: ['Owner', 'Admin'],
    WasteReasonsRead: ['Owner', 'Admin', 'AdminViewer', 'StockManager', 'Cashier'],
  };

  it('has an expectation for every policy in the shared map', () => {
    expect(Object.keys(expectedByPolicy).sort()).toEqual(Object.keys(PolicyPermissions).sort());
  });

  it('admits exactly the roles each policy admitted before', () => {
    for (const [policy, keys] of Object.entries(PolicyPermissions)) {
      for (const role of Object.values(AppRoles)) {
        const held = SystemRolePermissions[role];
        const allowed = keys.some((key) => held.includes(key));
        expect(allowed, `${policy} for ${role}`).toBe(expectedByPolicy[policy].includes(role));
      }
    }
  });

  it('keeps Cashier out of the products and customers screens the API still lets it load', () => {
    const cashier = SystemRolePermissions[AppRoles.Cashier];
    expect(cashier).not.toContain('products.read');
    expect(cashier).not.toContain('customers.read');
    expect(cashier).toContain('orders.write');
    expect(PolicyPermissions['ProductsRead']).toContain('orders.write');
    expect(PolicyPermissions['CustomersRead']).toContain('orders.write');
  });
});
