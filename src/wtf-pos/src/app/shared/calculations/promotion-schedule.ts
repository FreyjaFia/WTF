/**
 * When a promotion runs: the weekdays, the daily window and the usage limit. The TypeScript counterpart of
 * `PromotionSchedule` in the API's `WTF.Calculations` project; both run the same cases from `calculation-cases.json`.
 * The API judges every saved order; this only decides what the POS shows and previews.
 */

/** The weekday bit is `1 << day` with Sunday as day 0, so Sunday is 1, Monday 2 ... Saturday 64. */
export const EVERY_DAY = 127;

export const WEEKDAY_BITS: readonly { bit: number; short: string; long: string }[] = [
  { bit: 2, short: 'Mon', long: 'Monday' },
  { bit: 4, short: 'Tue', long: 'Tuesday' },
  { bit: 8, short: 'Wed', long: 'Wednesday' },
  { bit: 16, short: 'Thu', long: 'Thursday' },
  { bit: 32, short: 'Fri', long: 'Friday' },
  { bit: 64, short: 'Sat', long: 'Saturday' },
  { bit: 1, short: 'Sun', long: 'Sunday' },
];

export interface PromotionSchedule {
  /** Bit mask of the days it runs on. Missing means every day. */
  daysOfWeek?: number | null;
  /** Time of day it starts and stops ("14:00"). Both or neither. Missing means all day. */
  startTime?: string | null;
  endTime?: string | null;
  /** How many times it can be used in total. Missing means no limit. */
  maxRedemptions?: number | null;
  /** How many times it has been used so far. */
  redemptions?: number | null;
}

function secondsOfDay(time: string): number {
  const [hours, minutes, seconds] = time.split(':').map((part) => Number(part));
  return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
}

/** Whether the weekday and the hour of `now` (the device's local time) are inside the schedule. */
export function isScheduleOpen(schedule: PromotionSchedule | null | undefined, now: Date): boolean {
  if (!schedule) {
    return true;
  }

  if (schedule.daysOfWeek != null && (schedule.daysOfWeek & (1 << now.getDay())) === 0) {
    return false;
  }

  if (!schedule.startTime || !schedule.endTime) {
    return true;
  }

  const time = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const start = secondsOfDay(schedule.startTime);
  const end = secondsOfDay(schedule.endTime);

  // The end itself is not included. A window that ends before it starts runs past midnight.
  return start <= end ? time >= start && time < end : time >= start || time < end;
}

/** How many more uses the promotion has, or null when it has no limit. */
export function usesLeft(schedule: PromotionSchedule | null | undefined): number | null {
  if (schedule?.maxRedemptions == null) {
    return null;
  }

  return Math.max(0, schedule.maxRedemptions - (schedule.redemptions ?? 0));
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map((part) => Number(part));
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** The weekdays as a short text: "Every day", "Mon, Wed, Fri". */
export function describeDays(daysOfWeek: number | null | undefined): string {
  if (daysOfWeek == null || daysOfWeek === EVERY_DAY) {
    return 'Every day';
  }

  return WEEKDAY_BITS.filter((day) => (daysOfWeek & day.bit) !== 0)
    .map((day) => day.short)
    .join(', ');
}

/** The daily window as a short text: "All day", "2:00 PM - 5:00 PM". */
export function describeWindow(schedule: PromotionSchedule | null | undefined): string {
  if (!schedule?.startTime || !schedule.endTime) {
    return 'All day';
  }

  return `${formatTime(schedule.startTime)} - ${formatTime(schedule.endTime)}`;
}

/** The usage limit as a short text: "No limit", "12 of 50 used". */
export function describeLimit(schedule: PromotionSchedule | null | undefined): string {
  if (schedule?.maxRedemptions == null) {
    return 'No limit';
  }

  return `${schedule.redemptions ?? 0} of ${schedule.maxRedemptions} used`;
}
