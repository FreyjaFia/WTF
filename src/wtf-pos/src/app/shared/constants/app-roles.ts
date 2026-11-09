export const AppRoles = {
  Owner: 'Owner',
  Admin: 'Admin',
  Cashier: 'Cashier',
  AdminViewer: 'AdminViewer',
  ItemManager: 'ItemManager',
  StockManager: 'StockManager',
} as const;

export type AppRole = (typeof AppRoles)[keyof typeof AppRoles];

export const AppRoleLabels: Record<AppRole, string> = {
  [AppRoles.Owner]: 'Owner',
  [AppRoles.Admin]: 'Admin',
  [AppRoles.Cashier]: 'Cashier',
  [AppRoles.AdminViewer]: 'Admin Viewer',
  [AppRoles.ItemManager]: 'Item Manager',
  [AppRoles.StockManager]: 'Stock Manager',
};
