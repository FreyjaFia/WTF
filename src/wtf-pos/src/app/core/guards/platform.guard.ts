import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PlatformService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

export const platformGuard: CanActivateFn = () => {
  const platform = inject(PlatformService);
  const router = inject(Router);

  if (platform.isSignedIn()) {
    return true;
  }

  platform.logout();
  router.navigateByUrl(AppRoutes.PlatformLogin, { replaceUrl: true });

  return false;
};
