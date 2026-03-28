export const AppRoutes = {
  Login: '/login',
  Dashboard: '/dashboard',
  MyProfile: '/my-profile',
  OrdersRoot: '/orders',
  OrdersList: '/orders/list',
  OrdersEditor: '/orders/editor',
  OrderEditorById: (orderId: string) => `/orders/editor/${orderId}`,
  OrderDetailsById: (orderId: string) => `/orders/details/${orderId}`,
  ManagementRoot: '/management',
  ManagementProducts: '/management/products',
  ManagementProductsNew: '/management/products/new',
  ManagementProductDetailsById: (productId: string) => `/management/products/details/${productId}`,
  ManagementProductEditById: (productId: string) => `/management/products/edit/${productId}`,
  ManagementCustomers: '/management/customers',
  ManagementCustomersNew: '/management/customers/new',
  ManagementCustomerDetailsById: (customerId: string) =>
    `/management/customers/details/${customerId}`,
  ManagementCustomerEditById: (customerId: string) => `/management/customers/edit/${customerId}`,
  ManagementUsers: '/management/users',
  ManagementUsersNew: '/management/users/new',
  ManagementUserDetailsById: (userId: string) => `/management/users/details/${userId}`,
  ManagementUserEditById: (userId: string) => `/management/users/edit/${userId}`,
  ManagementPromotions: '/management/promotions',
  ManagementPromotionsNew: '/management/promotions/new',
  ManagementPromotionFixedBundleDetailsById: (promoId: string) =>
    `/management/promotions/fixed-bundles/${promoId}`,
  ManagementPromotionMixMatchDetailsById: (promoId: string) =>
    `/management/promotions/mix-match/${promoId}`,
  ManagementPromotionFixedBundleEditById: (promoId: string) =>
    `/management/promotions/fixed-bundles/${promoId}/edit`,
  ManagementPromotionMixMatchEditById: (promoId: string) =>
    `/management/promotions/mix-match/${promoId}/edit`,
  ManagementReports: '/management/reports',
  ManagementAuditLogs: '/management/audit-logs',
  ManagementSchemaScripts: '/management/schema-scripts',
} as const;
