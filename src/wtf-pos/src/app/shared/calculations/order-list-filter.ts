import { OrderStatusEnum } from '@shared/models/order.models';

export type OrderDateRangeId = 'today' | '7d' | '30d' | 'custom';

export interface DateBounds {
  from?: string;
  to?: string;
}

export interface OrderListFilter {
  statuses: readonly OrderStatusEnum[];
  bounds: DateBounds;
  source?: number;
}

interface FilterableOrder {
  status: OrderStatusEnum;
  createdAt?: string | null;
  source?: number | null;
}

export function dateRangeBounds(
  range: string | undefined,
  customStart: string,
  customEnd: string,
  now: Date = new Date(),
): DateBounds {
  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString() };
  }

  if (range === '7d' || range === '30d') {
    const start = new Date(now);
    start.setDate(now.getDate() - (range === '7d' ? 7 : 30));
    return { from: start.toISOString() };
  }

  if (range === 'custom' && customStart && customEnd) {
    return {
      from: new Date(`${customStart}T00:00:00`).toISOString(),
      to: new Date(`${customEnd}T23:59:59.999`).toISOString(),
    };
  }

  return {};
}

export function orderMatchesListFilter(order: FilterableOrder, filter: OrderListFilter): boolean {
  if (filter.statuses.length > 0) {
    if (!filter.statuses.includes(order.status)) {
      return false;
    }
  } else if (
    order.status === OrderStatusEnum.PendingApproval ||
    order.status === OrderStatusEnum.PendingReview
  ) {
    return false;
  }

  if (filter.source !== undefined && (order.source ?? 0) !== filter.source) {
    return false;
  }

  const created = order.createdAt ? new Date(order.createdAt).getTime() : NaN;
  if (filter.bounds.from && !(created >= new Date(filter.bounds.from).getTime())) {
    return false;
  }

  if (filter.bounds.to && !(created <= new Date(filter.bounds.to).getTime())) {
    return false;
  }

  return true;
}
