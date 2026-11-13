import { Routes } from '@angular/router';
import { authGuard } from '@core/guards/auth.guard';
import { loginGuard } from '@core/guards/login.guard';
import { platformGuard } from '@core/guards/platform.guard';
import { roleGuard } from '@core/guards/role.guard';
import { unsavedChangesGuard } from '@core/guards/unsaved-changes.guard';
import { Dashboard } from '@features/dashboard/dashboard';
import { InventoryComponent } from '@features/inventory/inventory';
import { InventoryHubComponent } from '@features/inventory/hub/inventory-hub';
import { ItemDetailsComponent } from '@features/inventory/items/item-details/item-details';
import { ItemEditorComponent } from '@features/inventory/items/item-editor/item-editor';
import { ItemListComponent } from '@features/inventory/items/item-list/item-list';
import { ItemsComponent } from '@features/inventory/items/items';
import { StockAttentionComponent } from '@features/inventory/stock-attention/stock-attention';
import { IngredientEditorComponent } from '@features/inventory/ingredient-editor/ingredient-editor';
import { IngredientsComponent } from '@features/inventory/ingredients/ingredients';
import { StockInComponent } from '@features/inventory/stock-in/stock-in';
import { StockCountSheetComponent } from '@features/inventory/counts/stock-count-sheet';
import { StockCountsComponent } from '@features/inventory/counts/stock-counts';
import { PurchaseOrdersComponent } from '@features/inventory/purchase-orders/purchase-orders';
import { SuggestedOrdersComponent } from '@features/inventory/purchase-orders/suggested-orders/suggested-orders';
import { ReceivingComponent } from '@features/inventory/receiving/receiving';
import { SupplierDetailsComponent } from '@features/inventory/suppliers/supplier-details';
import { SuppliersComponent } from '@features/inventory/suppliers/suppliers';
import { WasteComponent } from '@features/inventory/waste/waste';
import { Login } from '@features/login/login';
import { AuditLogsComponent } from '@features/management/audit-logs/audit-logs';
import { CustomerDetailsComponent } from '@features/management/customers/customer-details/customer-details';
import { CustomerEditorComponent } from '@features/management/customers/customer-editor/customer-editor';
import { CustomerListComponent } from '@features/management/customers/customer-list/customer-list';
import { CustomersComponent } from '@features/management/customers/customers';
import { ManagementComponent } from '@features/management/management';
import { ManagementHubComponent } from '@features/management/hub/management-hub';
import { ProductDetailsComponent } from '@features/management/products/product-details/product-details';
import { ProductEditorComponent } from '@features/management/products/product-editor/product-editor';
import { ProductListComponent } from '@features/management/products/product-list/product-list';
import { ProductsComponent } from '@features/management/products/products';
import { PromotionDetailsComponent } from '@features/management/promotions/promotion-details/promotion-details';
import { PromotionEditorComponent } from '@features/management/promotions/promotion-editor/promotion-editor';
import { PromotionListComponent } from '@features/management/promotions/promotion-list/promotion-list';
import { PromotionsComponent } from '@features/management/promotions/promotions';
import { ReportsComponent } from '@features/management/reports/reports';
import { SchemaScriptsComponent } from '@features/management/schema-scripts/schema-scripts';
import { RoleEditorComponent } from '@features/management/roles/role-editor/role-editor';
import { RoleListComponent } from '@features/management/roles/role-list/role-list';
import { RolesComponent } from '@features/management/roles/roles';
import { UserDetailsComponent } from '@features/management/users/user-details/user-details';
import { UserEditorComponent } from '@features/management/users/user-editor/user-editor';
import { UserListComponent } from '@features/management/users/user-list/user-list';
import { UsersComponent } from '@features/management/users/users';
import { BrandPageComponent } from '@features/management/brand/brand-page';
import { SubscriptionPageComponent } from '@features/management/subscription/subscription-page';
import { ExpensesComponent } from '@features/management/expenses/expenses';
import { SetupComponent } from '@features/management/setup/setup';
import { ShopComponent } from '@features/management/shop/shop';
import { NotFoundComponent } from '@features/not-found/not-found';
import { NotInPlanComponent } from '@features/not-in-plan/not-in-plan';
import { NotificationsComponent } from '@features/notifications/notifications';
import { OrderDetails } from '@features/orders/order-details/order-details';
import { OrderEditor } from '@features/orders/order-editor/order-editor';
import { OrderList } from '@features/orders/order-list/order-list';
import { Orders } from '@features/orders/orders';
import { PlatformLoginComponent } from '@features/platform/platform-login';
import { PlatformLogComponent } from '@features/platform/platform-log';
import { PlatformOverviewComponent } from '@features/platform/platform-overview';
import { PlatformPlansComponent } from '@features/platform/platform-plans';
import { PlatformShellComponent } from '@features/platform/platform-shell';
import { PlatformTenantDetailComponent } from '@features/platform/platform-tenant-detail';
import { PlatformTenantsComponent } from '@features/platform/platform-tenants';
import { PublicOrderComponent } from '@features/public-order/public-order';
import { LayoutComponent } from '@shared/components';
import { ManagementMenuPermissions, Permissions, SetupPermissions } from '@shared/permissions';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    component: Login,
    canActivate: [loginGuard],
  },
  {
    path: 'platform/login',
    component: PlatformLoginComponent,
  },
  {
    path: 'platform',
    component: PlatformShellComponent,
    canActivate: [platformGuard],
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', component: PlatformOverviewComponent },
      { path: 'shops', component: PlatformTenantsComponent },
      { path: 'shops/:id', component: PlatformTenantDetailComponent },
      { path: 'plans', component: PlatformPlansComponent },
      { path: 'log', component: PlatformLogComponent },
    ],
  },
  {
    // Public page for customers with a personal ordering link. No sign-in, so no guards.
    // The menu, the order list and one order are addresses of the same page, so Back, Refresh and shared links work.
    path: 'shop/:token',
    component: PublicOrderComponent,
    children: [
      { path: '', children: [] },
      { path: 'orders', children: [] },
      { path: 'orders/:id', children: [] },
    ],
  },
  {
    // Links sent before the page moved to /shop keep working.
    path: 'order/:token',
    redirectTo: 'shop/:token',
    pathMatch: 'full',
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'orders',
        component: Orders,
        children: [
          { path: '', redirectTo: 'list', pathMatch: 'full' },
          {
            path: 'editor',
            component: OrderEditor,
            canActivate: [roleGuard],
            canDeactivate: [unsavedChangesGuard],
            data: { permission: Permissions.OrdersWrite },
          },
          {
            path: 'editor/:id',
            component: OrderEditor,
            canActivate: [roleGuard],
            canDeactivate: [unsavedChangesGuard],
            data: { permission: Permissions.OrdersWrite },
          },
          {
            path: 'details/:id',
            component: OrderDetails,
            canActivate: [roleGuard],
            data: { permission: Permissions.OrdersRead },
          },
          {
            path: 'list',
            component: OrderList,
            canActivate: [roleGuard],
            data: { permission: Permissions.OrdersRead },
          },
        ],
      },
      { path: 'not-in-plan', component: NotInPlanComponent },
      {
        path: 'dashboard',
        component: Dashboard,
        canActivate: [roleGuard],
        data: { permission: Permissions.DashboardRead },
      },
      {
        path: 'inventory',
        component: InventoryComponent,
        children: [
          { path: '', component: InventoryHubComponent, pathMatch: 'full' },
          {
            path: 'items',
            component: ItemsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.ItemsRead },
            children: [
              {
                path: '',
                component: ItemListComponent,
              },
              {
                path: 'new',
                component: ItemEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.ItemsWrite },
              },
              {
                path: 'details/:id',
                component: ItemDetailsComponent,
              },
              {
                path: 'edit/:id',
                component: ItemEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.ItemsWrite },
              },
            ],
          },
          {
            path: 'stock-in',
            component: StockInComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.StockRead },
          },
          {
            path: 'attention',
            component: StockAttentionComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.StockRead },
          },
          {
            path: 'counts',
            component: StockCountsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.StockRead },
          },
          {
            path: 'counts/:id',
            component: StockCountSheetComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.StockRead },
          },
          {
            path: 'reorder',
            redirectTo: 'purchase-orders/suggestions',
            pathMatch: 'full',
          },
          {
            path: 'purchase-orders/suggestions',
            component: SuggestedOrdersComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.PurchasingRead },
          },
          {
            path: 'purchase-orders',
            component: PurchaseOrdersComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.PurchasingRead },
          },
          {
            path: 'receiving',
            component: ReceivingComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.PurchasingRead },
          },
          { path: 'suppliers', redirectTo: '/management/setup/suppliers', pathMatch: 'full' },
          { path: 'suppliers/:id', redirectTo: '/management/setup/suppliers/:id', pathMatch: 'full' },
          {
            path: 'waste',
            component: WasteComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.StockRead },
          },
          {
            path: 'alerts',
            redirectTo: 'attention',
            pathMatch: 'full',
          },
          {
            path: 'coverage',
            redirectTo: 'ingredients',
            pathMatch: 'full',
          },
          {
            path: 'ingredients',
            component: IngredientsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.ItemsRead },
          },
          {
            path: 'ingredients/:productId',
            component: IngredientEditorComponent,
            canActivate: [roleGuard],
            canDeactivate: [unsavedChangesGuard],
            data: { permission: Permissions.ItemsRead },
          },
        ],
      },
      {
        path: 'notifications',
        component: NotificationsComponent,
      },
      {
        path: 'my-profile',
        component: UserEditorComponent,
        canDeactivate: [unsavedChangesGuard],
        data: { isProfile: true },
      },
      {
        path: 'management',
        component: ManagementComponent,
        canActivate: [roleGuard],
        data: { anyPermission: ManagementMenuPermissions },
        children: [
          {
            path: '',
            component: ManagementHubComponent,
            pathMatch: 'full',
          },
          {
            path: 'products',
            component: ProductsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.ProductsRead },
            children: [
              {
                path: '',
                component: ProductListComponent,
              },
              {
                path: 'new',
                component: ProductEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.ProductsWrite },
              },
              {
                path: 'details/:id',
                component: ProductDetailsComponent,
              },
              {
                path: 'edit/:id',
                component: ProductEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.ProductsWrite },
              },
            ],
          },
          {
            path: 'customers',
            component: CustomersComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.CustomersRead },
            children: [
              {
                path: '',
                component: CustomerListComponent,
              },
              {
                path: 'new',
                component: CustomerEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.CustomersWrite },
              },
              {
                path: 'details/:id',
                component: CustomerDetailsComponent,
              },
              {
                path: 'edit/:id',
                component: CustomerEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.CustomersWrite },
              },
            ],
          },
          {
            path: 'users',
            component: UsersComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.UsersRead },
            children: [
              {
                path: '',
                component: UserListComponent,
              },
              {
                path: 'new',
                component: UserEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.UsersWrite },
              },
              {
                path: 'details/:id',
                component: UserDetailsComponent,
              },
              {
                path: 'edit/:id',
                component: UserEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.UsersWrite },
              },
            ],
          },
          {
            path: 'roles',
            component: RolesComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.RolesManage },
            children: [
              {
                path: '',
                component: RoleListComponent,
              },
              {
                path: 'new',
                component: RoleEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.RolesManage },
              },
              {
                path: ':id',
                component: RoleEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.RolesManage },
              },
            ],
          },
          {
            path: 'promotions',
            component: PromotionsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.PromotionsRead },
            children: [
              {
                path: '',
                component: PromotionListComponent,
              },
              {
                path: 'new',
                component: PromotionEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.PromotionsWrite },
              },
              {
                path: 'fixed-bundles/:id',
                component: PromotionDetailsComponent,
              },
              {
                path: 'fixed-bundles/:id/edit',
                component: PromotionEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.PromotionsWrite },
              },
              {
                path: 'mix-match/:id',
                component: PromotionDetailsComponent,
              },
              {
                path: 'mix-match/:id/edit',
                component: PromotionEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.PromotionsWrite },
              },
              {
                path: 'discounted-products/:id',
                component: PromotionDetailsComponent,
              },
              {
                path: 'discounted-products/:id/edit',
                component: PromotionEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.PromotionsWrite },
              },
              {
                path: 'details/:id',
                component: PromotionDetailsComponent,
              },
              {
                path: 'edit/:id',
                component: PromotionEditorComponent,
                canDeactivate: [unsavedChangesGuard],
                canActivate: [roleGuard],
                data: { permission: Permissions.PromotionsWrite },
              },
            ],
          },
          {
            path: 'reports',
            component: ReportsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.ReportsRead },
          },
          {
            path: 'schema-scripts',
            component: SchemaScriptsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.SchemaScriptsRead },
          },
          {
            path: 'audit-logs',
            component: AuditLogsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.AuditRead },
          },
          {
            path: 'expenses',
            component: ExpensesComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.ExpensesRead },
          },
          { path: 'catalog', redirectTo: 'setup/categories', pathMatch: 'full' },
          { path: 'waste-reasons', redirectTo: 'setup/waste-reasons', pathMatch: 'full' },
          {
            path: 'setup',
            component: SetupComponent,
            canActivate: [roleGuard],
            data: { anyPermission: SetupPermissions },
          },
          {
            path: 'setup/suppliers',
            component: SuppliersComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.SuppliersRead },
          },
          {
            path: 'setup/suppliers/:id',
            component: SupplierDetailsComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.SuppliersRead },
          },
          {
            path: 'setup/:kind',
            component: SetupComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.ProductsRead },
          },
          { path: 'subscription', redirectTo: 'shop/plan', pathMatch: 'full' },
          { path: 'brand', redirectTo: 'shop/branding', pathMatch: 'full' },
          {
            path: 'shop',
            component: ShopComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.BrandManage },
          },
          {
            path: 'shop/branding',
            component: BrandPageComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.BrandManage },
          },
          {
            path: 'shop/plan',
            component: SubscriptionPageComponent,
            canActivate: [roleGuard],
            data: { permission: Permissions.SubscriptionBilling },
          },
        ],
      },
    ],
  },
  {
    path: '**',
    component: NotFoundComponent,
  },
];
