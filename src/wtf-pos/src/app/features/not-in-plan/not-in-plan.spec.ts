import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService, PlanStore } from '@core/services';
import { SubscriptionDto } from '@shared/models/subscription.models';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotInPlanComponent } from './not-in-plan';

function render(options: { feature: string | null; canUpgrade: boolean; plans?: Record<string, string[]> }) {
  localStorage.clear();
  TestBed.configureTestingModule({
    imports: [NotInPlanComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { canManageSubscription: () => options.canUpgrade } },
      {
        provide: ActivatedRoute,
        useValue: { queryParamMap: of(convertToParamMap(options.feature ? { feature: options.feature } : {})) },
      },
    ],
  });
  TestBed.inject(PlanStore).apply({
    managed: true,
    planName: 'Starter',
    features: [],
    plansByFeature: options.plans ?? {},
  } as unknown as SubscriptionDto);
  const fixture = TestBed.createComponent(NotInPlanComponent);
  fixture.detectChanges();

  return fixture.nativeElement as HTMLElement;
}

describe('NotInPlanComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('names the screen and the plans that have it', () => {
    const el = render({ feature: 'purchasing', canUpgrade: true, plans: { purchasing: ['Business'] } });

    expect(el.querySelector('[data-testid="not-in-plan-title"]')?.textContent).toContain('Purchasing is not in your plan');
    expect(el.querySelector('[data-testid="not-in-plan-plans"]')?.textContent).toContain('Available in Business.');
  });

  it('lists every plan that has it', () => {
    const el = render({ feature: 'inventory', canUpgrade: true, plans: { inventory: ['Pro', 'Business'] } });

    expect(el.querySelector('[data-testid="not-in-plan-plans"]')?.textContent).toContain('Available in Pro and Business.');
  });

  it('tells the owner and admin how to upgrade', () => {
    const el = render({ feature: 'audit', canUpgrade: true });

    expect(el.querySelector('[data-testid="not-in-plan-upgrade"]')?.textContent).toContain('upgrade your plan from Plan & billing');
    expect(el.querySelector('[data-testid="not-in-plan-ask-owner"]')).toBeNull();
    expect(el.querySelector('a[href="/management/shop/plan"]')?.textContent).toContain('Plan & billing');
  });

  it('tells everyone else to ask the owner', () => {
    const el = render({ feature: 'audit', canUpgrade: false });

    expect(el.querySelector('[data-testid="not-in-plan-ask-owner"]')?.textContent).toContain('Ask the owner to upgrade the plan.');
    expect(el.querySelector('[data-testid="not-in-plan-upgrade"]')).toBeNull();
    expect(el.querySelector('a[href="/management/shop/plan"]')).toBeNull();
  });

  it('still makes sense when it does not know the feature', () => {
    const el = render({ feature: null, canUpgrade: false });

    expect(el.querySelector('[data-testid="not-in-plan-title"]')?.textContent).toContain('This feature is not in your plan');
    expect(el.querySelector('[data-testid="not-in-plan-plans"]')).toBeNull();
  });

  it('uses OnPush and still follows a changed feature in the URL', () => {
    localStorage.clear();
    const params = new BehaviorSubject(convertToParamMap({ feature: 'audit' }));
    TestBed.configureTestingModule({
      imports: [NotInPlanComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { canManageSubscription: () => false } },
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
      ],
    });
    const fixture = TestBed.createComponent(NotInPlanComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const title = () => el.querySelector('[data-testid="not-in-plan-title"]')?.textContent;
    const first = title();

    params.next(convertToParamMap({ feature: 'purchasing' }));
    fixture.detectChanges();

    expect(
      (NotInPlanComponent as unknown as { ɵcmp: { onPush: boolean } }).ɵcmp.onPush,
    ).toBe(true);
    expect(title()).not.toBe(first);
    expect(title()).toContain('Purchasing');
  });
});
