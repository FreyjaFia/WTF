export const AppRoles = {
  Owner: 'Owner',
  Admin: 'Admin',
  Cashier: 'Cashier',
  AdminViewer: 'AdminViewer',
  ItemManager: 'ItemManager',
  StockManager: 'StockManager',
} as const;

export type AppRole = (typeof AppRoles)[keyof typeof AppRoles];

/**
 * Role lists that are still hand-kept: the three UI-only menu groups below. Everything else is decided by
 * permissions (see shared/permissions); phase 2 of the RBAC plan derives these menus from permissions too.
 */
export const AppRoleGroups = {
  // UI only (no API policy): shows the Management menu and opens the Management section. Kept apart from
  // the per-area read permissions so a role can read some data without getting the Management area.
  ManagementAccess: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  // UI only: opens the Management shell and the menu entry. A Stock Manager gets in for Setup > Suppliers only; every tab inside checks its own permission.
  ManagementMenu: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager],
  SetupAccess: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager],
} as const satisfies Record<string, readonly AppRole[]>;

export const AppRoleLabels: Record<AppRole, string> = {
  [AppRoles.Owner]: 'Owner',
  [AppRoles.Admin]: 'Admin',
  [AppRoles.Cashier]: 'Cashier',
  [AppRoles.AdminViewer]: 'Admin Viewer',
  [AppRoles.ItemManager]: 'Item Manager',
  [AppRoles.StockManager]: 'Stock Manager',
};
