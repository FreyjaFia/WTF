import { Routes } from '@angular/router';
import { authGuard } from '@core/guards/auth.guard';
import { loginGuard } from '@core/guards/login.guard';
import { roleGuard } from '@core/guards/role.guard';
import { unsavedChangesGuard } from '@core/guards/unsaved-changes.guard';
import { Dashboard } from '@features/dashboard/dashboard';
import { Login } from '@features/login/login';
import { AuditLogsComponent } from '@features/management/audit-logs/audit-logs';
import { CustomerDetailsComponent } from '@features/management/customers/customer-details/customer-details';
import { CustomerEditorComponent } from '@features/management/customers/customer-editor/customer-editor';
import { CustomerListComponent } from '@features/management/customers/customer-list/customer-list';
import { CustomersComponent } from '@features/management/customers/customers';
import { ManagementComponent } from '@features/management/management';
import { ProductDetailsComponent } from '@features/management/products/product-details/product-details';
import { ProductEditorComponent } from '@features/management/products/product-editor/product-editor';
import { ProductListComponent } from '@features/management/products/product-list/product-list';
import { ProductsComponent } from '@features/management/products/products';
import { ReportsComponent } from '@features/management/reports/reports';
import { SchemaScriptsComponent } from '@features/management/schema-scripts/schema-scripts';
import { UserDetailsComponent } from '@features/management/users/user-details/user-details';
import { UserEditorComponent } from '@features/management/users/user-editor/user-editor';
import { UserListComponent } from '@features/management/users/user-list/user-list';
import { UsersComponent } from '@features/management/users/users';
import { NotFoundComponent } from '@features/not-found/not-found';
import { OrderEditor } from '@features/orders/order-editor/order-editor';
import { OrderList } from '@features/orders/order-list/order-list';
import { Orders } from '@features/orders/orders';
import { LayoutComponent } from '@shared/components';
import { AppRoleGroups } from '@shared/constants/app-roles';

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
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'orders',
        component: Orders,
        children: [
          { path: '', redirectTo: 'list', pathMatch: 'full' },
          { path: 'editor', component: OrderEditor, canDeactivate: [unsavedChangesGuard] },
          { path: 'editor/:id', component: OrderEditor, canDeactivate: [unsavedChangesGuard] },
          { path: 'list', component: OrderList },
        ],
      },
      {
        path: 'dashboard',
        component: Dashboard,
        canActivate: [roleGuard],
        data: { roles: AppRoleGroups.DashboardRead },
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
        data: { roles: AppRoleGroups.ManagementRead },
        children: [
          {
            path: '',
            redirectTo: 'products',
            pathMatch: 'full',
          },
          {
            path: 'products',
            component: ProductsComponent,
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
                data: { roles: AppRoleGroups.ManagementWrite },
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
                data: { roles: AppRoleGroups.ManagementWrite },
              },
            ],
          },
          {
            path: 'customers',
            component: CustomersComponent,
            canActivate: [roleGuard],
            data: { roles: AppRoleGroups.CustomersRead },
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
                data: { roles: AppRoleGroups.CustomersWrite },
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
                data: { roles: AppRoleGroups.CustomersWrite },
              },
            ],
          },
          {
            path: 'users',
            component: UsersComponent,
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
                data: { roles: AppRoleGroups.ManagementWrite },
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
                data: { roles: AppRoleGroups.ManagementWrite },
              },
            ],
          },
          {
            path: 'reports',
            component: ReportsComponent,
            canActivate: [roleGuard],
            data: { roles: AppRoleGroups.ReportsRead },
          },
          {
            path: 'schema-scripts',
            component: SchemaScriptsComponent,
            canActivate: [roleGuard],
            data: { roles: AppRoleGroups.SchemaScriptHistoryRead },
          },
          {
            path: 'audit-logs',
            component: AuditLogsComponent,
            canActivate: [roleGuard],
            data: { roles: AppRoleGroups.AuditRead },
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
