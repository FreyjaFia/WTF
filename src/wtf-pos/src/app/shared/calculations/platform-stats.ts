import { toCents, fromCents } from './money';

export interface PlatformShopRow {
  name: string;
  slug: string;
  status: number;
  userCount: number;
  orderCount: number;
  lastOrderAt: string | null;
  planName?: string | null;
  warning?: string | null;
}

export interface PlatformPlanPrice {
  name: string;
  monthlyPrice: number;
}

export interface PlatformSummary {
  total: number;
  trial: number;
  active: number;
  suspended: number;
  cancelled: number;
  people: number;
  orders: number;
  needsAttention: number;
  quiet: number;
  monthlyListPrice: number;
}

const TRIAL = 1;
const ACTIVE = 2;
const SUSPENDED = 3;
const CANCELLED = 4;
const QUIET_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTENTION_WARNINGS = ['soon', 'lastDays', 'grace', 'locked'];

export function isLiveShop(status: number): boolean {
  return status === TRIAL || status === ACTIVE;
}

export function needsAttention(shop: PlatformShopRow): boolean {
  return isLiveShop(shop.status) && ATTENTION_WARNINGS.includes(shop.warning ?? '');
}

export function isQuiet(shop: PlatformShopRow, now: Date): boolean {
  if (!isLiveShop(shop.status)) {
    return false;
  }

  if (!shop.lastOrderAt) {
    return true;
  }

  return now.getTime() - new Date(shop.lastOrderAt).getTime() > QUIET_DAYS * DAY_MS;
}

export function summarizeShops(shops: PlatformShopRow[], plans: PlatformPlanPrice[], now: Date): PlatformSummary {
  const priceByPlan = new Map(plans.map((p) => [p.name, toCents(p.monthlyPrice)]));
  let listCents = 0;
  const summary: PlatformSummary = {
    total: shops.length,
    trial: 0,
    active: 0,
    suspended: 0,
    cancelled: 0,
    people: 0,
    orders: 0,
    needsAttention: 0,
    quiet: 0,
    monthlyListPrice: 0,
  };

  for (const shop of shops) {
    summary.people += shop.userCount;
    summary.orders += shop.orderCount;
    summary.trial += shop.status === TRIAL ? 1 : 0;
    summary.active += shop.status === ACTIVE ? 1 : 0;
    summary.suspended += shop.status === SUSPENDED ? 1 : 0;
    summary.cancelled += shop.status === CANCELLED ? 1 : 0;
    summary.needsAttention += needsAttention(shop) ? 1 : 0;
    summary.quiet += isQuiet(shop, now) ? 1 : 0;

    if (shop.status === ACTIVE && shop.planName) {
      listCents += priceByPlan.get(shop.planName) ?? 0;
    }
  }

  summary.monthlyListPrice = fromCents(listCents);

  return summary;
}

export function filterShops<T extends PlatformShopRow>(shops: T[], query: string, statuses: number[]): T[] {
  const needle = query.trim().toLowerCase();

  return shops.filter((shop) => {
    if (statuses.length > 0 && !statuses.includes(shop.status)) {
      return false;
    }

    return !needle || shop.name.toLowerCase().includes(needle) || shop.slug.toLowerCase().includes(needle);
  });
}
