export const AppRoles = {
  SuperAdmin: 'SuperAdmin',
  Admin: 'Admin',
  Cashier: 'Cashier',
  AdminViewer: 'AdminViewer',
  ItemManager: 'ItemManager',
  StockManager: 'StockManager',
} as const;

export type AppRole = (typeof AppRoles)[keyof typeof AppRoles];

/**
 * Who may see each area of the UI (menus, management screens, buttons).
 *
 * These are intentionally NOT a copy of the API policies in WTF.Api AppAuthorizationExtensions: the API
 * is the wider, authoritative rule. Cashiers can read and write orders (new order page and order list)
 * and write customers (registering one from the new order page), but they have no products or customers
 * management screens, so they are absent from ProductsRead and CustomersRead here. The API still lets
 * them read products and customers because the order editor loads them through those endpoints (editing
 * an order calls GET /api/customers). A UI group must never grant a role the API denies;
 * app-roles.spec.ts enforces that.
 */
export const AppRoleGroups = {
  // UI only (no API policy): shows the Management menu and opens the Management section. Kept apart from
  // the per-area read groups below so a role can read some data without getting the Management area.
  ManagementAccess: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  DashboardRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  ProductsRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  ProductsWrite: [AppRoles.SuperAdmin, AppRoles.Admin],
  UsersRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  UsersWrite: [AppRoles.SuperAdmin, AppRoles.Admin],
  PromotionsRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  PromotionsWrite: [AppRoles.SuperAdmin, AppRoles.Admin],
  ReportsRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  ReportsGenerate: [AppRoles.SuperAdmin, AppRoles.Admin],
  AuditRead: [AppRoles.SuperAdmin],
  SchemaScriptHistoryRead: [AppRoles.SuperAdmin],
  OrdersRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier],
  OrdersWrite: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier],
  OrdersOverride: [AppRoles.SuperAdmin, AppRoles.Admin],
  OrderLinksWrite: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier],
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
