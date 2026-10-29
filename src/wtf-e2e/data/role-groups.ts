import { Role } from '@data/users';

// Copy of AppRoleGroups (wtf-pos shared/constants/app-roles.ts) and the API policies, written by role key so the
// specs never import app code. If a group changes in the app, these tables must change with it.
const ALL_STAFF: ReadonlyArray<Role> = ['superadmin', 'admin', 'viewer', 'cashier', 'stockmgr', 'itemmgr'];

export const GROUPS = {
  managementAccess: ['superadmin', 'admin', 'viewer'],
  dashboardRead: ['superadmin', 'admin', 'viewer'],
  productsRead: ['superadmin', 'admin', 'viewer'],
  productsWrite: ['superadmin', 'admin'],
  usersRead: ['superadmin', 'admin', 'viewer'],
  usersWrite: ['superadmin', 'admin'],
  promotionsRead: ['superadmin', 'admin', 'viewer'],
  promotionsWrite: ['superadmin', 'admin'],
  reportsRead: ['superadmin', 'admin', 'viewer'],
  auditRead: ['superadmin'],
  schemaScriptHistoryRead: ['superadmin'],
  ordersRead: ['superadmin', 'admin', 'viewer', 'cashier'],
  ordersWrite: ['superadmin', 'admin', 'cashier'],
  ordersOverride: ['superadmin', 'admin'],
  customersReadUi: ['superadmin', 'admin', 'viewer'],
  customersWrite: ['superadmin', 'admin', 'cashier'],
  itemsRead: ['superadmin', 'admin', 'viewer', 'itemmgr', 'stockmgr'],
  itemsWrite: ['superadmin', 'admin', 'itemmgr'],
  stockMovementsRead: ['superadmin', 'admin', 'viewer', 'stockmgr'],
  stockMovementsWrite: ['superadmin', 'admin', 'stockmgr'],
  stockWasteWrite: ['superadmin', 'admin', 'stockmgr', 'cashier'],
  stockWasteReview: ['superadmin', 'admin'],
  wasteReasonsManage: ['superadmin', 'admin'],
  wasteReasonsRead: ['superadmin', 'admin', 'viewer', 'stockmgr', 'cashier'],
  // API only: cashiers read products and customers because the order editor loads them.
  productsReadApi: ['superadmin', 'admin', 'viewer', 'cashier'],
  customersReadApi: ['superadmin', 'admin', 'viewer', 'cashier'],
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
