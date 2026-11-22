import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, provideRouter } from '@angular/router';
import { BranchService, PlanStore } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { beforeEach, describe, expect, it } from 'vitest';
import { multiBranchGuard } from './multi-branch.guard';

describe('multiBranchGuard', () => {
  let known = true;
  let hasBranchesFeature = true;
  let mine: object | null = {};
  let multi = true;

  const run = (): unknown =>
    TestBed.runInInjectionContext(() => multiBranchGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
  const path = (result: unknown): string => TestBed.inject(Router).serializeUrl(result as never);

  beforeEach(() => {
    known = true;
    hasBranchesFeature = true;
    mine = {};
    multi = true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PlanStore, useValue: { isKnown: () => known, hasFeature: () => hasBranchesFeature } },
        { provide: BranchService, useValue: { mine: () => mine, isMultiBranch: () => multi } },
      ],
    });
  });

  it('opens for a shop with several branches on a plan that has them', () => {
    expect(run()).toBe(true);
  });

  it('sends a plan without branches to the not-in-plan page', () => {
    hasBranchesFeature = false;

    expect(path(run())).toContain(AppRoutes.NotInPlan);
  });

  it('sends a shop with one branch back to the inventory hub', () => {
    multi = false;

    expect(path(run())).toBe(AppRoutes.InventoryRoot);
  });

  it('opens while the branch list has not loaded yet', () => {
    mine = null;
    multi = false;

    expect(run()).toBe(true);
  });

  it('opens while the plan is not known yet', () => {
    known = false;
    hasBranchesFeature = false;

    expect(run()).toBe(true);
  });
});
