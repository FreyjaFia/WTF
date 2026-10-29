export type Role = 'superadmin' | 'admin' | 'cashier' | 'viewer' | 'stockmgr' | 'itemmgr';

export const ROLE_IDS = {
  Admin: 1,
  Cashier: 2,
  AdminViewer: 3,
  SuperAdmin: 4,
  ItemManager: 5,
  StockManager: 6,
} as const;

export const USERNAMES: Record<Role, string> = {
  superadmin: process.env.E2E_USER_SUPERADMIN ?? 'superadmin',
  admin: process.env.E2E_USER_ADMIN ?? 'admin',
  cashier: process.env.E2E_USER_CASHIER ?? 'cashier',
  viewer: process.env.E2E_USER_VIEWER ?? 'viewer',
  stockmgr: process.env.E2E_USER_STOCKMGR ?? 'stockmgr',
  itemmgr: process.env.E2E_USER_ITEMMGR ?? 'itemmgr',
};

export const LANDING_PATH: Record<Role, string> = {
  superadmin: '/dashboard',
  admin: '/dashboard',
  viewer: '/dashboard',
  cashier: '/orders/editor',
  stockmgr: '/inventory/attention',
  itemmgr: '/inventory/items',
};

// Stock and item managers loop on login (app bug), so the tests open these pages directly.
export const ROLES_THAT_LOOP_ON_LOGIN: ReadonlyArray<Role> = ['stockmgr', 'itemmgr'];
