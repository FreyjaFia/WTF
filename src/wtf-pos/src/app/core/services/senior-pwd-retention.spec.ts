import { describe, expect, it } from 'vitest';
import { SENIOR_PWD_ID_RETENTION_DAYS, isPastIdRetention } from './senior-pwd-retention';

describe('isPastIdRetention', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  const daysAgo = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();

  it('keeps data up to the retention days and drops it after', () => {
    expect(isPastIdRetention(daysAgo(SENIOR_PWD_ID_RETENTION_DAYS), now)).toBe(false);
    expect(isPastIdRetention(daysAgo(SENIOR_PWD_ID_RETENTION_DAYS + 1), now)).toBe(true);
  });

  it('never drops what has no readable date', () => {
    expect(isPastIdRetention(undefined, now)).toBe(false);
    expect(isPastIdRetention('not a date', now)).toBe(false);
  });
});
