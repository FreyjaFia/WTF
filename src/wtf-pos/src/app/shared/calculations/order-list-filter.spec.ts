import { OrderStatusEnum } from '@shared/models/order.models';
import { dateRangeBounds, orderMatchesListFilter } from './order-list-filter';

describe('order list filter', () => {
  const now = new Date('2026-11-15T10:30:00');

  it('builds no bounds without a range or with an unfinished custom range', () => {
    expect(dateRangeBounds(undefined, '', '', now)).toEqual({});
    expect(dateRangeBounds('custom', '2026-11-01', '', now)).toEqual({});
  });

  it('starts today at local midnight', () => {
    const { from, to } = dateRangeBounds('today', '', '', now);
    expect(new Date(from!).getTime()).toBe(new Date('2026-11-15T00:00:00').getTime());
    expect(to).toBeUndefined();
  });

  it('goes back seven and thirty days', () => {
    expect(new Date(dateRangeBounds('7d', '', '', now).from!).getTime()).toBe(
      new Date('2026-11-08T10:30:00').getTime(),
    );
    expect(new Date(dateRangeBounds('30d', '', '', now).from!).getTime()).toBe(
      new Date('2026-10-16T10:30:00').getTime(),
    );
  });

  it('covers whole days in a custom range', () => {
    const { from, to } = dateRangeBounds('custom', '2026-11-01', '2026-11-02', now);
    expect(new Date(from!).getTime()).toBe(new Date('2026-11-01T00:00:00').getTime());
    expect(new Date(to!).getTime()).toBe(new Date('2026-11-02T23:59:59.999').getTime());
  });

  it('keeps unconfirmed orders out unless a status is picked', () => {
    const none = { statuses: [], bounds: {} };
    expect(orderMatchesListFilter({ status: OrderStatusEnum.Pending }, none)).toBe(true);
    expect(orderMatchesListFilter({ status: OrderStatusEnum.PendingApproval }, none)).toBe(false);
    expect(orderMatchesListFilter({ status: OrderStatusEnum.PendingReview }, none)).toBe(false);
  });

  it('matches the chosen statuses only', () => {
    const filter = { statuses: [OrderStatusEnum.Completed], bounds: {} };
    expect(orderMatchesListFilter({ status: OrderStatusEnum.Completed }, filter)).toBe(true);
    expect(orderMatchesListFilter({ status: OrderStatusEnum.Pending }, filter)).toBe(false);
  });

  it('checks the date range and source', () => {
    const filter = {
      statuses: [],
      bounds: { from: '2026-11-10T00:00:00.000Z', to: '2026-11-12T00:00:00.000Z' },
      source: 1,
    };
    const base = { status: OrderStatusEnum.Pending, source: 1 };
    expect(orderMatchesListFilter({ ...base, createdAt: '2026-11-11T00:00:00Z' }, filter)).toBe(true);
    expect(orderMatchesListFilter({ ...base, createdAt: '2026-11-13T00:00:00Z' }, filter)).toBe(false);
    expect(orderMatchesListFilter({ ...base, createdAt: '2026-11-09T00:00:00Z' }, filter)).toBe(false);
    expect(
      orderMatchesListFilter({ ...base, source: 0, createdAt: '2026-11-11T00:00:00Z' }, filter),
    ).toBe(false);
  });
});
