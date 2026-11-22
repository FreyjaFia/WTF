import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BranchService, PlanStore, notInPlanPath } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

// Screens that only make sense for a shop with several branches (and a plan that has them).
export const multiBranchGuard: CanActivateFn = () => {
  const plans = inject(PlanStore);
  const branches = inject(BranchService);
  const router = inject(Router);

  if (plans.isKnown() && !plans.hasFeature('branches')) {
    return router.parseUrl(notInPlanPath('branches'));
  }

  // Until the branch list has loaded the screen opens as before; it explains itself when there is nothing to move to.
  if (branches.mine() !== null && !branches.isMultiBranch()) {
    return router.parseUrl(AppRoutes.InventoryRoot);
  }

  return true;
};
