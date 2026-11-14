import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { daysLeft, defaultPlanCodeForNewShop, effectiveNow, leaseTooOld, warningLevel } from './subscription-rules';

interface WarningCase {
  name: string;
  periodEnd: string;
  graceDays: number;
  now: string;
  expectedLevel: string;
  expectedDaysLeft: number;
}

interface ClockCase {
  name: string;
  deviceNow: string;
  latestSeen: string | null;
  expectedNow: string;
}

interface LeaseCase {
  name: string;
  issuedAt: string;
  now: string;
  maxAgeDays: number;
  expected: boolean;
}

describe('subscription rules: the cases shared with the API', () => {
  it.each((cases.subscriptionWarnings as WarningCase[]).map((c) => [c.name, c] as const))(
    'warning: %s',
    (_name, c) => {
      const now = new Date(c.now);
      expect(warningLevel(new Date(c.periodEnd), c.graceDays, now)).toBe(c.expectedLevel);
      expect(daysLeft(new Date(c.periodEnd), now)).toBe(c.expectedDaysLeft);
    },
  );

  it.each((cases.subscriptionClock as ClockCase[]).map((c) => [c.name, c] as const))(
    'clock: %s',
    (_name, c) => {
      const seen = c.latestSeen ? new Date(c.latestSeen) : null;
      expect(effectiveNow(new Date(c.deviceNow), seen).toISOString()).toBe(
        new Date(c.expectedNow).toISOString(),
      );
    },
  );

  it.each((cases.subscriptionLeaseAge as LeaseCase[]).map((c) => [c.name, c] as const))(
    'lease age: %s',
    (_name, c) => {
      expect(leaseTooOld(new Date(c.issuedAt), new Date(c.now), c.maxAgeDays)).toBe(c.expected);
    },
  );
});

describe('default plan for a new shop', () => {
  const plan = (code: string, monthlyPrice: number, isActive = true) => ({ code, monthlyPrice, isActive });

  it('is the cheapest active paid plan', () => {
    expect(defaultPlanCodeForNewShop([plan('business', 3500), plan('starter', 1500), plan('pro', 2500)])).toBe('starter');
  });

  it('skips retired plans and free plans while a paid one exists', () => {
    expect(defaultPlanCodeForNewShop([plan('old', 500, false), plan('free', 0), plan('pro', 2500)])).toBe('pro');
  });

  it('falls back to the cheapest active plan, and to nothing when none is active', () => {
    expect(defaultPlanCodeForNewShop([plan('free', 0), plan('free2', 0)])).toBe('free');
    expect(defaultPlanCodeForNewShop([plan('old', 500, false)])).toBeNull();
    expect(defaultPlanCodeForNewShop([])).toBeNull();
  });
});
