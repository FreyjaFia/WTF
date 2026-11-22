import { PlanStore } from '@core/services';
import { describe, expect, it } from 'vitest';
import { inventoryGroups } from './hub-groups';

describe('inventoryGroups', () => {
  const auth = { canReadStockMovements: () => true, canReadItems: () => true, canReadPurchasing: () => true };
  const noop = { count: () => 0, urgentCount: () => 0, pendingCount: () => 0 };
  const cards = (multi: boolean, plan?: boolean) =>
    inventoryGroups(
      auth as never,
      noop as never,
      noop as never,
      { isMultiBranch: () => multi } as never,
      plan === undefined ? undefined : ({ hasFeature: () => plan } as unknown as PlanStore),
    ).flatMap((group) => group.cards);
  const transfers = (multi: boolean, plan?: boolean) => cards(multi, plan).find((card) => card.id === 'transfers')!;

  it('shows Transfers for a shop with branches on a plan that has them', () => {
    expect(transfers(true, true).canShow()).toBe(true);
  });

  it('hides Transfers when the plan has no branches feature', () => {
    expect(transfers(true, false).canShow()).toBe(false);
  });

  it('hides Transfers for a shop with one branch', () => {
    expect(transfers(false, true).canShow()).toBe(false);
  });
});
