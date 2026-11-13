import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService, PlanStore } from '@core/services';
import { PlanFeatureCatalog } from '@shared/calculations/plan-features';
import { AppRoutes } from '@shared/constants/app-routes';
import { map } from 'rxjs';

@Component({
  selector: 'app-not-in-plan',
  imports: [RouterLink],
  templateUrl: './not-in-plan.html',
})
export class NotInPlanComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly plans = inject(PlanStore);

  protected readonly routes = AppRoutes;

  private readonly featureKey = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('feature'))),
    { initialValue: null },
  );

  protected readonly screenName = computed(() => {
    const key = this.featureKey();
    return PlanFeatureCatalog.find((f) => f.key === key)?.label ?? 'This feature';
  });

  protected readonly availability = computed(() => {
    const key = this.featureKey();
    const names = key ? this.plans.plansHaving(key) : [];
    return names.length > 0 ? `Available in ${names.join(' and ')}.` : null;
  });

  protected readonly canUpgrade = computed(() => this.auth.canManageSubscription());
}
