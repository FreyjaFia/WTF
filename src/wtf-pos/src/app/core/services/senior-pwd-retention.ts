export const SENIOR_PWD_ID_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isPastIdRetention(savedAt: string | null | undefined, now: Date = new Date()): boolean {
  const saved = savedAt ? Date.parse(savedAt) : Number.NaN;
  if (Number.isNaN(saved)) {
    return false;
  }

  return now.getTime() - saved > SENIOR_PWD_ID_RETENTION_DAYS * DAY_MS;
}
