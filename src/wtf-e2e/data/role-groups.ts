import { Role } from '@data/users';

// Copy of what the system role permissions (wtf-pos shared/permissions) and the API policies grant, written by role key so the
// specs never import app code. If a role bundle changes in the app, these tables must change with it.
const ALL_STAFF: ReadonlyArray<Role> = ['owner', 'admin', 'viewer', 'cashier', 'stockmgr', 'itemmgr'];

export const GROUPS = {
  managementAccess: ['owner', 'admin', 'viewer'],
  managementMenu: ['owner', 'admin', 'viewer', 'stockmgr'],
  setupAccess: ['owner', 'admin', 'viewer', 'stockmgr'],
  shopManage: ['owner', 'admin'],
  dashboardRead: ['owner', 'admin', 'viewer'],
  productsRead: ['owner', 'admin', 'viewer'],
  productsWrite: ['owner', 'admin'],
  usersRead: ['owner', 'admin', 'viewer'],
  usersWrite: ['owner', 'admin'],
  rolesRead: ['owner', 'admin', 'viewer'],
  rolesManage: ['owner'],
  promotionsRead: ['owner', 'admin', 'viewer'],
  promotionsWrite: ['owner', 'admin'],
  reportsRead: ['owner', 'admin', 'viewer'],
  auditRead: ['owner'],
  schemaScriptHistoryRead: ['owner'],
  ordersRead: ['owner', 'admin', 'viewer', 'cashier'],
  ordersWrite: ['owner', 'admin', 'cashier'],
  ordersOverride: ['owner', 'admin'],
  customersReadUi: ['owner', 'admin', 'viewer'],
  customersWrite: ['owner', 'admin', 'cashier'],
  itemsRead: ['owner', 'admin', 'viewer', 'itemmgr', 'stockmgr'],
  itemsWrite: ['owner', 'admin', 'itemmgr'],
  stockMovementsRead: ['owner', 'admin', 'viewer', 'stockmgr'],
  stockMovementsWrite: ['owner', 'admin', 'stockmgr'],
  suppliersRead: ['owner', 'admin', 'viewer', 'stockmgr'],
  suppliersWrite: ['owner', 'admin', 'stockmgr'],
  stockWasteWrite: ['owner', 'admin', 'stockmgr', 'cashier'],
  stockWasteReview: ['owner', 'admin'],
  expensesRead: ['owner', 'admin', 'viewer'],
  expensesWrite: ['owner', 'admin'],
  wasteReasonsManage: ['owner', 'admin'],
  wasteReasonsRead: ['owner', 'admin', 'viewer', 'stockmgr', 'cashier'],
  // API only: cashiers read products and customers because the order editor loads them.
  productsReadApi: ['owner', 'admin', 'viewer', 'cashier'],
  customersReadApi: ['owner', 'admin', 'viewer', 'cashier'],
} as const satisfies Record<string, ReadonlyArray<Role>>;

export const STAFF_ROLES: ReadonlyArray<Role> = ALL_STAFF;

export function isIn(group: ReadonlyArray<Role>, role: Role): boolean {
  return group.includes(role);
}

// Where roleGuard sends someone who opens a page their role may not see.
export function guardFallback(role: Role): string {
  if (isIn(GROUPS.ordersRead, role)) {
    return '/orders/list';
  }

  if (isIn(GROUPS.managementAccess, role)) {
    return '/dashboard';
  }

  if (isIn(GROUPS.stockMovementsRead, role)) {
    return '/inventory/attention';
  }

  return isIn(GROUPS.itemsRead, role) ? '/inventory/items' : '/login';
}
