import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, PlanStore } from '@core/services';
import { AppRole } from '@shared/constants/app-roles';
import { AppRoutes } from '@shared/constants/app-routes';
import { PermissionCatalog, PermissionKey } from '@shared/permissions';
import { notInPlanPath } from './feature.guard';

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

function missingPlanFeature(
  plans: PlanStore,
  permission: PermissionKey | undefined,
  anyPermission: readonly PermissionKey[] | undefined,
): string | null {
  const keys = permission ? [permission] : (anyPermission ?? []);
  const features = keys.map((key) => PermissionCatalog.find((p) => p.key === key)?.feature ?? 'core');

  if (features.length === 0 || features.some((feature) => plans.hasFeature(feature))) {
    return null;
  }

  return features[0];
}

export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const plans = inject(PlanStore);

  const requiredRoles = (route.data?.['roles'] as AppRole[] | undefined) ?? [];
  const requiredPermission = route.data?.['permission'] as PermissionKey | undefined;
  const anyPermission = route.data?.['anyPermission'] as readonly PermissionKey[] | undefined;

  const roleAllowed = requiredRoles.length === 0 || auth.hasAnyRole(requiredRoles);
  const permissionAllowed = !requiredPermission || auth.can(requiredPermission);
  const anyAllowed = !anyPermission || auth.canAny(anyPermission);

  if (roleAllowed && permissionAllowed && anyAllowed) {
    return true;
  }

  const missingFeature = missingPlanFeature(plans, requiredPermission, anyPermission);

  if (missingFeature) {
    router.navigateByUrl(notInPlanPath(missingFeature));
    return false;
  }

  router.navigateByUrl(fallbackRouteFor(auth));
  return false;
};
