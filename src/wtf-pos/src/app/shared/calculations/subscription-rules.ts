export type SubscriptionWarning = 'none' | 'soon' | 'lastDays' | 'grace' | 'locked';

const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 7;
const LAST_DAYS = 3;

export function accessUntil(periodEnd: Date, graceDays: number): Date {
  return new Date(periodEnd.getTime() + Math.max(0, graceDays) * DAY_MS);
}

export function daysLeft(periodEnd: Date, now: Date): number {
  const remaining = periodEnd.getTime() - now.getTime();
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS);
}

export function warningLevel(periodEnd: Date, graceDays: number, now: Date): SubscriptionWarning {
  if (now.getTime() >= accessUntil(periodEnd, graceDays).getTime()) {
    return 'locked';
  }

  if (now.getTime() >= periodEnd.getTime()) {
    return 'grace';
  }

  const left = daysLeft(periodEnd, now);
  if (left <= LAST_DAYS) {
    return 'lastDays';
  }

  return left <= SOON_DAYS ? 'soon' : 'none';
}

export function effectiveNow(deviceNow: Date, latestSeen: Date | null): Date {
  return latestSeen !== null && latestSeen.getTime() > deviceNow.getTime() ? latestSeen : deviceNow;
}

export function leaseTooOld(issuedAt: Date, now: Date, maxAgeDays: number): boolean {
  return now.getTime() - issuedAt.getTime() > Math.max(0, maxAgeDays) * DAY_MS;
}

export interface ShopPlanChoice {
  code: string;
  isActive: boolean;
  monthlyPrice: number;
}

export function defaultPlanCodeForNewShop(plans: readonly ShopPlanChoice[]): string | null {
  const byPrice = plans.filter((plan) => plan.isActive).sort((a, b) => a.monthlyPrice - b.monthlyPrice);

  return (byPrice.find((plan) => plan.monthlyPrice > 0) ?? byPrice[0])?.code ?? null;
}
