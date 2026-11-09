import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRole } from '@shared/constants/app-roles';
import { AppRoutes } from '@shared/constants/app-routes';
import { PermissionKey } from '@shared/permissions';

function fallbackRouteFor(auth: AuthService): string {
  if (auth.canReadOrders()) {
    return AppRoutes.OrdersList;
  }

  if (auth.canReadManagement()) {
    return AppRoutes.Dashboard;
  }

  if (auth.canReadStockMovements()) {
    return AppRoutes.InventoryAttention;
  }

  if (auth.canReadItems()) {
    return AppRoutes.InventoryItems;
  }

  return auth.canOpenManagementMenu() ? AppRoutes.ManagementRoot : AppRoutes.Login;
}

export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const requiredRoles = (route.data?.['roles'] as AppRole[] | undefined) ?? [];
  const requiredPermission = route.data?.['permission'] as PermissionKey | undefined;
  const anyPermission = route.data?.['anyPermission'] as readonly PermissionKey[] | undefined;

  const roleAllowed = requiredRoles.length === 0 || auth.hasAnyRole(requiredRoles);
  const permissionAllowed = !requiredPermission || auth.can(requiredPermission);
  const anyAllowed = !anyPermission || auth.canAny(anyPermission);

  if (roleAllowed && permissionAllowed && anyAllowed) {
    return true;
  }

  router.navigateByUrl(fallbackRouteFor(auth));
  return false;
};
