import catalogJson from './permission-catalog.json';

export const Permissions = {
  OrdersRead: 'orders.read',
  OrdersWrite: 'orders.write',
  OrdersOverride: 'orders.override',
  OrderLinksManage: 'orderlinks.manage',
  CustomersRead: 'customers.read',
  CustomersWrite: 'customers.write',
  ProductsRead: 'products.read',
  ProductsWrite: 'products.write',
  ItemsRead: 'items.read',
  ItemsWrite: 'items.write',
  InventoryCostsRead: 'inventory.costs.read',
  InventoryCostsWrite: 'inventory.costs.write',
  StockRead: 'stock.read',
  StockWrite: 'stock.write',
  SuppliersRead: 'suppliers.read',
  SuppliersWrite: 'suppliers.write',
  StockWasteRecord: 'stock.waste.record',
  StockWasteReview: 'stock.waste.review',
  WasteReasonsRead: 'wastereasons.read',
  WasteReasonsManage: 'wastereasons.manage',
  ExpensesRead: 'expenses.read',
  ExpensesWrite: 'expenses.write',
  PromotionsRead: 'promotions.read',
  PromotionsWrite: 'promotions.write',
  DashboardRead: 'dashboard.read',
  ReportsRead: 'reports.read',
  ReportsGenerate: 'reports.generate',
  UsersRead: 'users.read',
  UsersWrite: 'users.write',
  BrandManage: 'brand.manage',
  SubscriptionBilling: 'subscription.billing',
  AuditRead: 'audit.read',
  SchemaScriptsRead: 'schemascripts.read',
} as const;

export type PermissionKey = (typeof Permissions)[keyof typeof Permissions];

export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly area: string;
  readonly label: string;
  readonly description: string;
  readonly feature: string;
  readonly requires: readonly PermissionKey[];
}

export const PermissionCatalog: readonly PermissionDefinition[] =
  catalogJson.catalog as readonly PermissionDefinition[];

export const SystemRolePermissions: Readonly<Record<string, readonly PermissionKey[]>> =
  catalogJson.systemRoles as Record<string, PermissionKey[]>;

export const PolicyPermissions: Readonly<Record<string, readonly PermissionKey[]>> =
  catalogJson.policies as Record<string, PermissionKey[]>;

export const SetupPermissions: readonly PermissionKey[] = [
  Permissions.ProductsRead,
  Permissions.WasteReasonsManage,
  Permissions.SuppliersRead,
];

export const ManagementMenuPermissions: readonly PermissionKey[] = [
  Permissions.ProductsRead,
  Permissions.CustomersRead,
  Permissions.UsersRead,
  Permissions.PromotionsRead,
  Permissions.ReportsRead,
  Permissions.ExpensesRead,
  ...SetupPermissions,
  Permissions.BrandManage,
  Permissions.SubscriptionBilling,
  Permissions.AuditRead,
  Permissions.SchemaScriptsRead,
];
