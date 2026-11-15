import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AppRoutes } from '@shared/constants/app-routes';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanGateService, isPlanGateInfo, notInPlanPath } from './plan-gate.service';

describe('PlanGateService', () => {
  const router = { url: '/management/roles/new', navigateByUrl: vi.fn() };
  let gate: PlanGateService;

  beforeEach(() => {
    router.url = '/management/roles/new';
    router.navigateByUrl.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }] });
    gate = TestBed.inject(PlanGateService);
  });

  it('opens Not in your plan with the feature and a marker the guard understands', () => {
    gate.redirectToNotInPlan('customroles', true);

    expect(router.navigateByUrl).toHaveBeenCalledWith(`${AppRoutes.NotInPlan}?feature=customroles`, {
      info: { reason: 'not_in_plan', unsaved: true },
    });
  });

  it('does not move the person twice while a redirect is under way', () => {
    router.navigateByUrl.mockReturnValue(new Promise(() => undefined));

    gate.redirectToNotInPlan('audit', false);
    gate.redirectToNotInPlan('audit', false);

    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it('does nothing when already on the page', () => {
    router.url = `${AppRoutes.NotInPlan}?feature=audit`;

    gate.redirectToNotInPlan('audit', false);

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('builds the plain path without a feature and recognises its own marker only', () => {
    expect(notInPlanPath(null)).toBe(AppRoutes.NotInPlan);
    expect(isPlanGateInfo({ reason: 'not_in_plan', unsaved: false })).toBe(true);
    expect(isPlanGateInfo({ reason: 'other' })).toBe(false);
    expect(isPlanGateInfo(undefined)).toBe(false);
  });
});
