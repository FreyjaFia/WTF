import { Injector, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { AuthService, PlanStore, SubscriptionService, notInPlanPath } from '@core/services';
import { AppRole } from '@shared/constants/app-roles';
import { AppRoutes } from '@shared/constants/app-routes';
import { PermissionCatalog, PermissionKey } from '@shared/permissions';
import { firstValueFrom } from 'rxjs';

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

async function denied(
  auth: AuthService,
  router: Router,
  plans: PlanStore,
  injector: Injector,
  requiredPermission: PermissionKey | undefined,
  anyPermission: readonly PermissionKey[] | undefined,
): Promise<boolean> {
  if (!plans.isKnown()) {
    // A direct address on a fresh load: ask the server for the plan so the right page opens.
    try {
      await injector.get(SubscriptionService).loadPlan();
    } catch {
      // No subscription service available: fall through to the permission fallback.
    }
  }

  const missingFeature = missingPlanFeature(plans, requiredPermission, anyPermission);
  const target = missingFeature ? notInPlanPath(missingFeature) : fallbackRouteFor(auth);

  if (!(await router.navigateByUrl(target)) && target !== AppRoutes.Login) {
    await router.navigateByUrl(AppRoutes.Login);
  }

  return false;
}

function isAllowed(auth: AuthService, plans: PlanStore, route: ActivatedRouteSnapshot): boolean {
  const requiredRoles = (route.data?.['roles'] as AppRole[] | undefined) ?? [];
  const requiredPermission = route.data?.['permission'] as PermissionKey | undefined;
  const anyPermission = route.data?.['anyPermission'] as readonly PermissionKey[] | undefined;

  const roleAllowed = requiredRoles.length === 0 || auth.hasAnyRole(requiredRoles);
  const permissionAllowed = !requiredPermission || auth.can(requiredPermission);
  const anyAllowed = !anyPermission || auth.canAny(anyPermission);

  // Permissions saved at sign-in can outlive a plan change, so a known plan is checked as well.
  const planAllows = !plans.isKnown() || missingPlanFeature(plans, requiredPermission, anyPermission) === null;

  return roleAllowed && permissionAllowed && anyAllowed && planAllows;
}

async function refreshedAllows(
  auth: AuthService,
  plans: PlanStore,
  injector: Injector,
  route: ActivatedRouteSnapshot,
): Promise<boolean> {
  // A stale plan or permission list (an upgrade since sign-in) must not turn a screen away: ask the server once.
  try {
    await injector.get(SubscriptionService).loadPlan();
    await firstValueFrom(auth.loadPermissions());
  } catch {
    return false;
  }

  return isAllowed(auth, plans, route);
}

async function recheckThenDeny(
  auth: AuthService,
  router: Router,
  plans: PlanStore,
  injector: Injector,
  route: ActivatedRouteSnapshot,
): Promise<boolean> {
  if (await refreshedAllows(auth, plans, injector, route)) {
    return true;
  }

  const requiredPermission = route.data?.['permission'] as PermissionKey | undefined;
  const anyPermission = route.data?.['anyPermission'] as readonly PermissionKey[] | undefined;

  return denied(auth, router, plans, injector, requiredPermission, anyPermission);
}

export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const plans = inject(PlanStore);
  const injector = inject(Injector);

  return isAllowed(auth, plans, route) ? true : recheckThenDeny(auth, router, plans, injector, route);
};
