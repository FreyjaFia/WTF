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
  ManagementAccess: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  // UI only: opens the Management shell and the menu entry. A Stock Manager gets in for Setup > Suppliers only; every tab inside checks its own read group.
  ManagementMenu: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager],
  SetupAccess: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager],
  DashboardRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  ProductsRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  ProductsWrite: [AppRoles.Owner, AppRoles.Admin],
  UsersRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  UsersWrite: [AppRoles.Owner, AppRoles.Admin],
  PromotionsRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  PromotionsWrite: [AppRoles.Owner, AppRoles.Admin],
  ReportsRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  ReportsGenerate: [AppRoles.Owner, AppRoles.Admin],
  AuditRead: [AppRoles.Owner],
  SchemaScriptHistoryRead: [AppRoles.Owner],
  OrdersRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier],
  OrdersWrite: [AppRoles.Owner, AppRoles.Admin, AppRoles.Cashier],
  OrdersOverride: [AppRoles.Owner, AppRoles.Admin],
  OrderLinksWrite: [AppRoles.Owner, AppRoles.Admin, AppRoles.Cashier],
  CustomersRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  CustomersWrite: [AppRoles.Owner, AppRoles.Admin, AppRoles.Cashier],
  ItemsRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.ItemManager, AppRoles.StockManager],
  ItemsWrite: [AppRoles.Owner, AppRoles.Admin, AppRoles.ItemManager],
  InventoryCostsRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  InventoryCostsWrite: [AppRoles.Owner, AppRoles.Admin],
  StockMovementsRead: [
    AppRoles.Owner,
    AppRoles.Admin,
    AppRoles.AdminViewer,
    AppRoles.StockManager,
  ],
  StockMovementsWrite: [AppRoles.Owner, AppRoles.Admin, AppRoles.StockManager],
  StockWasteWrite: [
    AppRoles.Owner,
    AppRoles.Admin,
    AppRoles.StockManager,
    AppRoles.Cashier,
  ],
  StockWasteReview: [AppRoles.Owner, AppRoles.Admin],
  ExpensesRead: [AppRoles.Owner, AppRoles.Admin, AppRoles.AdminViewer],
  ExpensesWrite: [AppRoles.Owner, AppRoles.Admin],
  WasteReasonsManage: [AppRoles.Owner, AppRoles.Admin],
  SubscriptionBilling: [AppRoles.Owner, AppRoles.Admin],
  BrandManage: [AppRoles.Owner, AppRoles.Admin],
  WasteReasonsRead: [
    AppRoles.Owner,
    AppRoles.Admin,
    AppRoles.AdminViewer,
    AppRoles.StockManager,
    AppRoles.Cashier,
  ],
} as const satisfies Record<string, readonly AppRole[]>;

export const AppRoleLabels: Record<AppRole, string> = {
  [AppRoles.Owner]: 'Owner',
  [AppRoles.Admin]: 'Admin',
  [AppRoles.Cashier]: 'Cashier',
  [AppRoles.AdminViewer]: 'Admin Viewer',
  [AppRoles.ItemManager]: 'Item Manager',
  [AppRoles.StockManager]: 'Stock Manager',
};
