import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PlanStore } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

export function notInPlanPath(feature: string): string {
  return `${AppRoutes.NotInPlan}?feature=${encodeURIComponent(feature)}`;
}

export const featureGuard: CanActivateFn = (route) => {
  const plans = inject(PlanStore);
  const router = inject(Router);
  const feature = route.data?.['feature'] as string | undefined;

  if (!feature || plans.hasFeature(feature)) {
    return true;
  }

  return router.parseUrl(notInPlanPath(feature));
};
