export const DatePresets = {
  Today: 'today',
  Yesterday: 'yesterday',
  Last7Days: 'last-7-days',
  Last30Days: 'last-30-days',
  ThisWeek: 'this-week',
  LastWeek: 'last-week',
  ThisMonth: 'this-month',
  LastMonth: 'last-month',
  ThisQuarter: 'this-quarter',
  YearToDate: 'year-to-date',
  Custom: 'custom',
} as const;

export type DatePreset = (typeof DatePresets)[keyof typeof DatePresets];

export interface DatePresetOption {
  value: DatePreset;
  label: string;
}

export interface DateRange {
  fromDate: string;
  toDate: string;
}

export const DATE_PRESET_OPTIONS: readonly DatePresetOption[] = [
  { value: DatePresets.Today, label: 'Today' },
  { value: DatePresets.Yesterday, label: 'Yesterday' },
  { value: DatePresets.Last7Days, label: 'Last 7 Days' },
  { value: DatePresets.Last30Days, label: 'Last 30 Days' },
  { value: DatePresets.ThisWeek, label: 'This Week' },
  { value: DatePresets.LastWeek, label: 'Last Week' },
  { value: DatePresets.ThisMonth, label: 'This Month' },
  { value: DatePresets.LastMonth, label: 'Last Month' },
  { value: DatePresets.ThisQuarter, label: 'This Quarter' },
  { value: DatePresets.YearToDate, label: 'Year to Date' },
  { value: DatePresets.Custom, label: 'Custom Range' },
];

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The days a preset covers, counted from `today`; null for a custom range, which the user picks. Weeks start on Monday. */
export function resolveDatePreset(preset: DatePreset, today: Date): DateRange | null {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  const daysSinceMonday = (today.getDay() + 6) % 7;

  switch (preset) {
    case DatePresets.Today:
      return toRange(new Date(year, month, day), new Date(year, month, day));
    case DatePresets.Yesterday:
      return toRange(new Date(year, month, day - 1), new Date(year, month, day - 1));
    case DatePresets.Last7Days:
      return toRange(new Date(year, month, day - 6), new Date(year, month, day));
    case DatePresets.Last30Days:
      return toRange(new Date(year, month, day - 29), new Date(year, month, day));
    case DatePresets.ThisWeek:
      return toRange(new Date(year, month, day - daysSinceMonday), new Date(year, month, day));
    case DatePresets.LastWeek:
      return toRange(
        new Date(year, month, day - daysSinceMonday - 7),
        new Date(year, month, day - daysSinceMonday - 1),
      );
    case DatePresets.ThisMonth:
      return toRange(new Date(year, month, 1), new Date(year, month, day));
    case DatePresets.LastMonth:
      return toRange(new Date(year, month - 1, 1), new Date(year, month, 0));
    case DatePresets.ThisQuarter:
      return toRange(new Date(year, Math.floor(month / 3) * 3, 1), new Date(year, month, day));
    case DatePresets.YearToDate:
      return toRange(new Date(year, 0, 1), new Date(year, month, day));
    default:
      return null;
  }
}

function toRange(from: Date, to: Date): DateRange {
  return { fromDate: toDateInputValue(from), toDate: toDateInputValue(to) };
}
