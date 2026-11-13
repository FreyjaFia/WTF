import { describe, expect, it } from 'vitest';
import {
  ManagementMenuPermissions,
  PermissionCatalog,
  PolicyPermissions,
  SetupPermissions,
  SystemRolePermissions,
} from '@shared/permissions';
import { AppRoleLabels, AppRoles } from './app-roles';

describe('app roles', () => {
  const roles = Object.values(AppRoles);

  it('has a human-readable label for every role', () => {
    for (const role of roles) {
      expect(AppRoleLabels[role]).toBeTruthy();
    }
    expect(Object.keys(AppRoleLabels).sort()).toEqual([...roles].sort());
  });

  it('always lets Owner do everything', () => {
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
    RolesRead: ['Owner', 'Admin', 'AdminViewer'],
    RolesManage: ['Owner'],
    PromotionsRead: ['Owner', 'Admin', 'AdminViewer'],
    PromotionsWrite: ['Owner', 'Admin'],
    ReportsRead: ['Owner', 'Admin', 'AdminViewer'],
    ReportsGenerate: ['Owner', 'Admin'],
    AuditRead: ['Owner'],
    SchemaScriptHistoryRead: ['Owner'],
    OrdersRead: ['Owner', 'Admin', 'AdminViewer', 'Cashier'],
    OrdersWrite: ['Owner', 'Admin', 'Cashier'],
    OrdersOverride: ['Owner', 'Admin'],
    OrdersSyncPolicy: ['Owner'],
    OrderLinksManage: ['Owner', 'Admin', 'Cashier'],
    CustomersRead: ['Owner', 'Admin', 'AdminViewer', 'Cashier'],
    CustomersWrite: ['Owner', 'Admin', 'Cashier'],
    ItemsRead: ['Owner', 'Admin', 'AdminViewer', 'ItemManager', 'StockManager'],
    ItemsWrite: ['Owner', 'Admin', 'ItemManager'],
    InventoryCostsRead: ['Owner', 'Admin', 'AdminViewer'],
    InventoryCostsWrite: ['Owner', 'Admin'],
    StockMovementsRead: ['Owner', 'Admin', 'AdminViewer', 'StockManager'],
    StockMovementsWrite: ['Owner', 'Admin', 'StockManager'],
    SuppliersRead: ['Owner', 'Admin', 'AdminViewer', 'StockManager'],
    SuppliersWrite: ['Owner', 'Admin', 'StockManager'],
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

describe('menus derived from permissions', () => {
  const opens = (role: string, keys: readonly string[]): boolean =>
    keys.some((key) => (SystemRolePermissions[role] as readonly string[]).includes(key));

  it('opens the Management menu for the same roles as before', () => {
    const open = Object.values(AppRoles).filter((role) => opens(role, ManagementMenuPermissions));
    expect(open).toEqual([AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager]);
  });

  it('opens Setup for the same roles as before', () => {
    const open = Object.values(AppRoles).filter((role) => opens(role, SetupPermissions));
    expect(open).toEqual([AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager]);
  });

  it('gives Stock Manager only Setup > Suppliers inside Management', () => {
    const held = SystemRolePermissions[AppRoles.StockManager];
    const management = ManagementMenuPermissions.filter((key) => held.includes(key));
    expect(management).toEqual(['suppliers.read']);
    expect(held).not.toContain('dashboard.read');
  });

  it('keeps Cashier and Item Manager out of Management', () => {
    expect(opens(AppRoles.Cashier, ManagementMenuPermissions)).toBe(false);
    expect(opens(AppRoles.ItemManager, ManagementMenuPermissions)).toBe(false);
  });
});
