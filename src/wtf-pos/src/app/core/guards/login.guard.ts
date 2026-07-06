import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isTokenValid()) {
    const route = auth.canReadManagement()
      ? AppRoutes.Dashboard
      : auth.canWriteOrders()
        ? AppRoutes.OrdersEditor
        : AppRoutes.OrdersList;
    router.navigateByUrl(route, { replaceUrl: true });
    return false;
  }

  return true;
};
