import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRole } from '@shared/constants/app-roles';
import { AppRoutes } from '@shared/constants/app-routes';

export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const requiredRoles = (route.data?.['roles'] as AppRole[] | undefined) ?? [];

  if (requiredRoles.length === 0 || auth.hasAnyRole(requiredRoles)) {
    return true;
  }

  const fallbackRoute = auth.canReadOrders()
    ? AppRoutes.OrdersList
    : auth.canReadManagement()
      ? AppRoutes.Dashboard
      : AppRoutes.Login;
  router.navigateByUrl(fallbackRoute);
  return false;
};
