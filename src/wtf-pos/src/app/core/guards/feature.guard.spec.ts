import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { PlanStore } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { SubscriptionDto } from '@shared/models/subscription.models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { featureGuard } from './feature.guard';

const state = {} as RouterStateSnapshot;

function routeWithFeature(feature?: string): ActivatedRouteSnapshot {
  return { data: feature ? { feature } : {} } as unknown as ActivatedRouteSnapshot;
}

describe('featureGuard', () => {
  const parseUrl = vi.fn((url: string) => ({ url }));

  beforeEach(() => {
    localStorage.clear();
    parseUrl.mockClear();
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { parseUrl } }] });
  });

  const run = (route: ActivatedRouteSnapshot) =>
    TestBed.runInInjectionContext(() => featureGuard(route, state));

  it('lets a route without a feature through', () => {
    expect(run(routeWithFeature())).toBe(true);
  });

  it('lets everything through until the plan is known', () => {
    expect(run(routeWithFeature('inventory'))).toBe(true);
  });

  it('lets a feature in the plan through', () => {
    TestBed.inject(PlanStore).apply({ managed: true, features: ['inventory'] } as SubscriptionDto);

    expect(run(routeWithFeature('inventory'))).toBe(true);
  });

  it('sends a feature outside the plan to the Not in your plan page', () => {
    TestBed.inject(PlanStore).apply({ managed: true, features: ['inventory'] } as SubscriptionDto);

    run(routeWithFeature('promotions'));

    expect(parseUrl).toHaveBeenCalledWith(`${AppRoutes.NotInPlan}?feature=promotions`);
  });

  it('lets everything through for a shop with no subscription', () => {
    TestBed.inject(PlanStore).apply({ managed: false, features: [] } as unknown as SubscriptionDto);

    expect(run(routeWithFeature('promotions'))).toBe(true);
  });
});
