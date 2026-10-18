import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import {
  describeDays,
  describeLimit,
  describeWindow,
  EVERY_DAY,
  isScheduleOpen,
  usesLeft,
} from './promotion-schedule';

interface ScheduleCase {
  name: string;
  daysOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  local: string;
  expected: boolean;
}

describe('promotion schedule: the cases shared with the API', () => {
  it.each((cases.scheduleOpen as ScheduleCase[]).map((c) => [c.name, c] as const))(
    'open at a moment: %s',
    (_name, c) => {
      const schedule = { daysOfWeek: c.daysOfWeek, startTime: c.startTime, endTime: c.endTime };

      expect(isScheduleOpen(schedule, new Date(c.local))).toBe(c.expected);
    },
  );
});

describe('promotion schedule: pieces', () => {
  it('has no schedule means always open', () => {
    expect(isScheduleOpen(null, new Date('2026-06-10T03:00:00'))).toBe(true);
    expect(isScheduleOpen(undefined, new Date('2026-06-10T03:00:00'))).toBe(true);
  });

  it('counts the uses left, never below zero, and null without a limit', () => {
    expect(usesLeft(null)).toBeNull();
    expect(usesLeft({ maxRedemptions: null })).toBeNull();
    expect(usesLeft({ maxRedemptions: 10, redemptions: 3 })).toBe(7);
    expect(usesLeft({ maxRedemptions: 10 })).toBe(10);
    expect(usesLeft({ maxRedemptions: 10, redemptions: 12 })).toBe(0);
  });

  it('describes the days', () => {
    expect(describeDays(null)).toBe('Every day');
    expect(describeDays(EVERY_DAY)).toBe('Every day');
    expect(describeDays(2 | 8 | 32)).toBe('Mon, Wed, Fri');
    expect(describeDays(1 | 64)).toBe('Sat, Sun');
  });

  it('describes the window in 12-hour time', () => {
    expect(describeWindow(null)).toBe('All day');
    expect(describeWindow({ startTime: '14:00', endTime: null })).toBe('All day');
    expect(describeWindow({ startTime: '14:00', endTime: '17:30' })).toBe('2:00 PM - 5:30 PM');
    expect(describeWindow({ startTime: '00:00', endTime: '12:00' })).toBe('12:00 AM - 12:00 PM');
  });

  it('describes the limit', () => {
    expect(describeLimit(null)).toBe('No limit');
    expect(describeLimit({ maxRedemptions: 50, redemptions: 12 })).toBe('12 of 50 used');
    expect(describeLimit({ maxRedemptions: 50 })).toBe('0 of 50 used');
  });
});
