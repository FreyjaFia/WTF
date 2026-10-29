import { TIME_ZONE } from '@data/env';

const DAY_MS: number = 24 * 60 * 60 * 1000;

export function manilaDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date);
}

export function today(): string {
  return manilaDate();
}

export function daysFromToday(days: number): string {
  return manilaDate(new Date(Date.now() + days * DAY_MS));
}

export function isoInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}
