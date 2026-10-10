export const AppRoles = {
  SuperAdmin: 'SuperAdmin',
  Admin: 'Admin',
  Cashier: 'Cashier',
  AdminViewer: 'AdminViewer',
  ItemManager: 'ItemManager',
  StockManager: 'StockManager',
} as const;

export type AppRole = (typeof AppRoles)[keyof typeof AppRoles];

export const AppRoleGroups = {
  DashboardRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  ProductsRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  ProductsWrite: [AppRoles.SuperAdmin, AppRoles.Admin],
  UsersRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  UsersWrite: [AppRoles.SuperAdmin, AppRoles.Admin],
  PromotionsRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  PromotionsWrite: [AppRoles.SuperAdmin, AppRoles.Admin],
  ReportsRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  AuditRead: [AppRoles.SuperAdmin],
  SchemaScriptHistoryRead: [AppRoles.SuperAdmin],
  OrdersRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier],
  OrdersWrite: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier],
  OrdersOverride: [AppRoles.SuperAdmin, AppRoles.Admin],
  CustomersRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  CustomersWrite: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier],
  ItemsRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.ItemManager],
  ItemsWrite: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.ItemManager],
  StockMovementsRead: [
    AppRoles.SuperAdmin,
    AppRoles.Admin,
    AppRoles.AdminViewer,
    AppRoles.StockManager,
  ],
  StockMovementsWrite: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.StockManager],
} as const satisfies Record<string, readonly AppRole[]>;

export const AppRoleLabels: Record<AppRole, string> = {
  [AppRoles.SuperAdmin]: 'Super Admin',
  [AppRoles.Admin]: 'Admin',
  [AppRoles.Cashier]: 'Cashier',
  [AppRoles.AdminViewer]: 'Admin Viewer',
  [AppRoles.ItemManager]: 'Item Manager',
  [AppRoles.StockManager]: 'Stock Manager',
};
