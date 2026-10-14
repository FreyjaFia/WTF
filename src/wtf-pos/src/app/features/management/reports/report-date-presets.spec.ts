import { describe, expect, it } from 'vitest';
import {
  DATE_PRESET_OPTIONS,
  DatePreset,
  DatePresets,
  resolveDatePreset,
  toDateInputValue,
} from './report-date-presets';

describe('report date presets', () => {
  // Wednesday 14 Oct 2026
  const wednesday = new Date(2026, 9, 14);

  const range = (preset: DatePreset, today = wednesday) => resolveDatePreset(preset, today);

  it('formats a date as yyyy-mm-dd with padding', () => {
    expect(toDateInputValue(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateInputValue(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('lists every preset once, with a label', () => {
    const values = DATE_PRESET_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.sort()).toEqual(Object.values(DatePresets).sort());
    expect(DATE_PRESET_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });

  it('today and yesterday are single days', () => {
    expect(range(DatePresets.Today)).toEqual({ fromDate: '2026-10-14', toDate: '2026-10-14' });
    expect(range(DatePresets.Yesterday)).toEqual({ fromDate: '2026-10-13', toDate: '2026-10-13' });
  });

  it('yesterday crosses a month boundary', () => {
    expect(range(DatePresets.Yesterday, new Date(2026, 2, 1))).toEqual({
      fromDate: '2026-02-28',
      toDate: '2026-02-28',
    });
  });

  it('last 7 and 30 days include today', () => {
    expect(range(DatePresets.Last7Days)).toEqual({ fromDate: '2026-10-08', toDate: '2026-10-14' });
    expect(range(DatePresets.Last30Days)).toEqual({ fromDate: '2026-09-15', toDate: '2026-10-14' });
  });

  it('weeks start on Monday', () => {
    expect(range(DatePresets.ThisWeek)).toEqual({ fromDate: '2026-10-12', toDate: '2026-10-14' });
    expect(range(DatePresets.LastWeek)).toEqual({ fromDate: '2026-10-05', toDate: '2026-10-11' });
  });

  it('on a Monday this week is one day and last week ends yesterday', () => {
    const monday = new Date(2026, 9, 12);
    expect(range(DatePresets.ThisWeek, monday)).toEqual({ fromDate: '2026-10-12', toDate: '2026-10-12' });
    expect(range(DatePresets.LastWeek, monday)).toEqual({ fromDate: '2026-10-05', toDate: '2026-10-11' });
  });

  it('on a Sunday this week still starts on the Monday before', () => {
    const sunday = new Date(2026, 9, 18);
    expect(range(DatePresets.ThisWeek, sunday)).toEqual({ fromDate: '2026-10-12', toDate: '2026-10-18' });
  });

  it('this month runs from the 1st to today; last month is the whole previous month', () => {
    expect(range(DatePresets.ThisMonth)).toEqual({ fromDate: '2026-10-01', toDate: '2026-10-14' });
    expect(range(DatePresets.LastMonth)).toEqual({ fromDate: '2026-09-01', toDate: '2026-09-30' });
  });

  it('last month in January is December of the year before', () => {
    expect(range(DatePresets.LastMonth, new Date(2026, 0, 20))).toEqual({
      fromDate: '2025-12-01',
      toDate: '2025-12-31',
    });
  });

  it('last month copes with a leap February', () => {
    expect(range(DatePresets.LastMonth, new Date(2028, 2, 10))).toEqual({
      fromDate: '2028-02-01',
      toDate: '2028-02-29',
    });
  });

  it('quarter starts on the first day of its first month', () => {
    expect(range(DatePresets.ThisQuarter)).toEqual({ fromDate: '2026-10-01', toDate: '2026-10-14' });
    expect(range(DatePresets.ThisQuarter, new Date(2026, 4, 20))).toEqual({
      fromDate: '2026-04-01',
      toDate: '2026-05-20',
    });
    expect(range(DatePresets.ThisQuarter, new Date(2026, 1, 3))).toEqual({
      fromDate: '2026-01-01',
      toDate: '2026-02-03',
    });
  });

  it('year to date starts on 1 January', () => {
    expect(range(DatePresets.YearToDate)).toEqual({ fromDate: '2026-01-01', toDate: '2026-10-14' });
  });

  it('a custom range is left to the user', () => {
    expect(range(DatePresets.Custom)).toBeNull();
  });
});
