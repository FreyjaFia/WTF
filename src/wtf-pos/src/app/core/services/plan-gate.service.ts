import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppRoutes } from '@shared/constants/app-routes';

export const NOT_IN_PLAN_REASON = 'not_in_plan';

export interface PlanGateNavigationInfo {
  reason: typeof NOT_IN_PLAN_REASON;
  unsaved: boolean;
}

export function notInPlanPath(feature: string | null | undefined): string {
  return feature ? `${AppRoutes.NotInPlan}?feature=${encodeURIComponent(feature)}` : AppRoutes.NotInPlan;
}

export function isPlanGateInfo(info: unknown): info is PlanGateNavigationInfo {
  return (info as PlanGateNavigationInfo | null)?.reason === NOT_IN_PLAN_REASON;
}

@Injectable({ providedIn: 'root' })
export class PlanGateService {
  private readonly router = inject(Router);

  private redirecting = false;

  public redirectToNotInPlan(feature: string | null | undefined, unsaved: boolean): void {
    if (this.redirecting || this.router.url.startsWith(AppRoutes.NotInPlan)) {
      return;
    }

    this.redirecting = true;
    const info: PlanGateNavigationInfo = { reason: NOT_IN_PLAN_REASON, unsaved };

    void this.router.navigateByUrl(notInPlanPath(feature), { info }).finally(() => {
      this.redirecting = false;
    });
  }
}
