import { describe, expect, it } from 'vitest';
import { PlatformShopRow, filterShops, isQuiet, needsAttention, summarizeShops } from './platform-stats';

const NOW = new Date('2026-11-08T00:00:00Z');

const shop = (over: Partial<PlatformShopRow>): PlatformShopRow => ({
  name: 'Moon Brew',
  slug: 'moonbrew',
  status: 2,
  userCount: 2,
  orderCount: 10,
  lastOrderAt: '2026-11-07T00:00:00Z',
  planName: 'Standard',
  warning: 'none',
  ...over,
});

describe('platform stats', () => {
  it('counts shops by status and adds people and orders', () => {
    const summary = summarizeShops(
      [shop({}), shop({ status: 1 }), shop({ status: 3 }), shop({ status: 4, userCount: 1, orderCount: 5 })],
      [],
      NOW,
    );

    expect([summary.total, summary.active, summary.trial, summary.suspended, summary.cancelled]).toEqual([4, 1, 1, 1, 1]);
    expect(summary.people).toBe(7);
    expect(summary.orders).toBe(35);
  });

  it('adds the list price of active shops exactly, ignoring trial and suspended ones', () => {
    const plans = [{ name: 'Standard', monthlyPrice: 0.1 }, { name: 'Pro', monthlyPrice: 0.2 }];
    const summary = summarizeShops(
      [shop({}), shop({ planName: 'Pro' }), shop({ status: 1 }), shop({ status: 3 }), shop({ planName: 'Gone' })],
      plans,
      NOW,
    );

    expect(summary.monthlyListPrice).toBe(0.3);
  });

  it('flags live shops with a payment warning, not suspended ones', () => {
    expect(needsAttention(shop({ warning: 'grace' }))).toBe(true);
    expect(needsAttention(shop({ warning: 'none' }))).toBe(false);
    expect(needsAttention(shop({ warning: 'locked', status: 3 }))).toBe(false);
  });

  it('calls a live shop quiet after 30 days without an order, or with none at all', () => {
    expect(isQuiet(shop({ lastOrderAt: '2026-10-01T00:00:00Z' }), NOW)).toBe(true);
    expect(isQuiet(shop({ lastOrderAt: '2026-10-20T00:00:00Z' }), NOW)).toBe(false);
    expect(isQuiet(shop({ lastOrderAt: null }), NOW)).toBe(true);
    expect(isQuiet(shop({ lastOrderAt: null, status: 4 }), NOW)).toBe(false);
  });

  it('filters by name or address and by status', () => {
    const shops = [shop({}), shop({ name: 'Sun Cafe', slug: 'sun', status: 3 })];

    expect(filterShops(shops, 'SUN', []).map((s) => s.slug)).toEqual(['sun']);
    expect(filterShops(shops, 'moonb', []).map((s) => s.slug)).toEqual(['moonbrew']);
    expect(filterShops(shops, '', [3]).map((s) => s.slug)).toEqual(['sun']);
    expect(filterShops(shops, '  ', [])).toHaveLength(2);
    expect(filterShops(shops, '', [2, 3])).toHaveLength(2);
    expect(filterShops(shops, '', [4])).toHaveLength(0);
  });
});
