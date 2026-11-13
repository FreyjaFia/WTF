import { TestBed } from '@angular/core/testing';
import { SubscriptionDto } from '@shared/models/subscription.models';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlanStore } from './plan-store';

const dto = (patch: Partial<SubscriptionDto>): SubscriptionDto =>
  ({ managed: true, planName: 'Pro', features: ['inventory'], plansByFeature: {}, ...patch }) as SubscriptionDto;

describe('PlanStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('allows every feature until the plan is known', () => {
    const store = TestBed.inject(PlanStore);

    expect(store.isKnown()).toBe(false);
    expect(store.hasFeature('promotions')).toBe(true);
  });

  it('allows only the features in the plan, and always core', () => {
    const store = TestBed.inject(PlanStore);
    store.apply(dto({ features: ['inventory'] }));

    expect(store.isKnown()).toBe(true);
    expect(store.hasFeature('inventory')).toBe(true);
    expect(store.hasFeature('promotions')).toBe(false);
    expect(store.hasFeature('core')).toBe(true);
    expect(store.planName()).toBe('Pro');
  });

  it('allows everything for a shop with no subscription row', () => {
    const store = TestBed.inject(PlanStore);
    store.apply(dto({ managed: false, features: [], planName: null }));

    expect(store.isKnown()).toBe(false);
    expect(store.hasFeature('audit')).toBe(true);
  });

  it('names the plans that have a feature', () => {
    const store = TestBed.inject(PlanStore);
    store.apply(dto({ plansByFeature: { audit: ['Business'] } }));

    expect(store.plansHaving('audit')).toEqual(['Business']);
    expect(store.plansHaving('chat')).toEqual([]);
  });

  it('keeps the plan for the next start, so the menu is right with no connection', () => {
    TestBed.inject(PlanStore).apply(dto({ features: ['inventory'] }));
    TestBed.resetTestingModule();

    const next = TestBed.inject(PlanStore);

    expect(next.hasFeature('promotions')).toBe(false);
    expect(next.hasFeature('inventory')).toBe(true);
  });

  it('forgets the plan when cleared', () => {
    const store = TestBed.inject(PlanStore);
    store.apply(dto({ features: [] }));
    store.clear();

    expect(store.hasFeature('promotions')).toBe(true);
    expect(localStorage.getItem('wtf-plan-snapshot')).toBeNull();
  });
});
