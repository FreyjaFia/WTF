export const AppRoles = {
  SuperAdmin: 'SuperAdmin',
  Admin: 'Admin',
  Cashier: 'Cashier',
  AdminViewer: 'AdminViewer',
} as const;

export type AppRole = (typeof AppRoles)[keyof typeof AppRoles];

export const AppRoleGroups = {
  DashboardRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  ManagementRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  ManagementWrite: [AppRoles.SuperAdmin, AppRoles.Admin],
  AuditRead: [AppRoles.SuperAdmin],
  SchemaScriptHistoryRead: [AppRoles.SuperAdmin],
  CustomersRead: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
  CustomersWrite: [AppRoles.SuperAdmin, AppRoles.Admin],
  OrdersManage: [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier],
} as const satisfies Record<string, readonly AppRole[]>;

export const AppRoleLabels: Record<AppRole, string> = {
  [AppRoles.SuperAdmin]: 'Super Admin',
  [AppRoles.Admin]: 'Admin',
  [AppRoles.Cashier]: 'Cashier',
  [AppRoles.AdminViewer]: 'Admin Viewer',
};
