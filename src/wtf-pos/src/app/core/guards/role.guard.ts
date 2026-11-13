import { HttpClient } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, PlanStore } from '@core/services';
import { SubscriptionDto } from '@shared/models/subscription.models';
import { environment } from '@environments/environment.development';
import { firstValueFrom } from 'rxjs';
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
  const injector = inject(Injector);

  const requiredRoles = (route.data?.['roles'] as AppRole[] | undefined) ?? [];
  const requiredPermission = route.data?.['permission'] as PermissionKey | undefined;
  const anyPermission = route.data?.['anyPermission'] as readonly PermissionKey[] | undefined;

  const roleAllowed = requiredRoles.length === 0 || auth.hasAnyRole(requiredRoles);
  const permissionAllowed = !requiredPermission || auth.can(requiredPermission);
  const anyAllowed = !anyPermission || auth.canAny(anyPermission);

  if (roleAllowed && permissionAllowed && anyAllowed) {
    return true;
  }

  return denied(auth, router, plans, injector, requiredPermission, anyPermission);
};

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
      const http = injector.get(HttpClient);
      plans.apply(await firstValueFrom(http.get<SubscriptionDto>(`${environment.apiUrl}/subscription`)));
    } catch {
      // Offline or refused: fall through to the permission fallback.
    }
  }

  const missingFeature = missingPlanFeature(plans, requiredPermission, anyPermission);

  if (missingFeature) {
    router.navigateByUrl(notInPlanPath(missingFeature));
    return false;
  }

  router.navigateByUrl(fallbackRouteFor(auth));
  return false;
}
