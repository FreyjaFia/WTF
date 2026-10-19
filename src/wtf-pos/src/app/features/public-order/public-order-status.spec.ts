import { PublicOrderDto } from '@shared/models';
import { describe, expect, it } from 'vitest';
import {
  publicStatusNote,
  publicStatusNoteClass,
  publicStatusVariant,
  publicTimeline,
  publicStatusAccent,
} from './public-order-status';

const make = (over: Partial<PublicOrderDto> = {}): PublicOrderDto => ({
  id: 'o1',
  orderNumber: 1001,
  createdAt: '2026-01-11T09:00:00',
  statusLabel: 'x',
  statusKind: 'waiting',
  items: [],
  total: 100,
  fulfillmentType: 'Pickup',
  ...over,
});

const summary = (order: PublicOrderDto) =>
  publicTimeline(order).map((step) => `${step.key}:${step.state}`);

describe('publicTimeline', () => {
  it('a waiting order has been placed and awaits acceptance', () => {
    expect(summary(make())).toEqual([
      'placed:done',
      'accepted:current',
      'ready:upcoming',
      'completed:upcoming',
    ]);
  });

  it('an accepted order is being prepared', () => {
    expect(summary(make({ statusKind: 'accepted', acceptedAt: '2026-01-11T09:05:00' }))).toEqual([
      'placed:done',
      'accepted:done',
      'ready:current',
      'completed:upcoming',
    ]);
  });

  it('a ready order waits to be completed', () => {
    expect(summary(make({ statusKind: 'ready' }))).toEqual([
      'placed:done',
      'accepted:done',
      'ready:done',
      'completed:current',
    ]);
  });

  it('a completed order has every step done, even one the shop did not mark', () => {
    expect(summary(make({ statusKind: 'completed' }))).toEqual([
      'placed:done',
      'accepted:done',
      'ready:done',
      'completed:done',
    ]);
  });

  it('carries each time; a step that was skipped shows the time of the step after it', () => {
    const steps = publicTimeline(
      make({
        statusKind: 'completed',
        acceptedAt: '2026-01-11T09:05:00',
        readyAt: null,
        finishedAt: '2026-01-11T09:40:00',
      }),
    );
    expect(steps.map((s) => s.at)).toEqual([
      '2026-01-11T09:00:00',
      '2026-01-11T09:05:00',
      '2026-01-11T09:40:00',
      '2026-01-11T09:40:00',
    ]);
  });

  it('shows the same time for accepted, ready and completed when the shop went straight to checkout', () => {
    const steps = publicTimeline(
      make({ statusKind: 'completed', acceptedAt: null, readyAt: null, finishedAt: '2026-01-11T09:40:00' }),
    );

    expect(steps.map((s) => s.at)).toEqual([
      '2026-01-11T09:00:00',
      '2026-01-11T09:40:00',
      '2026-01-11T09:40:00',
      '2026-01-11T09:40:00',
    ]);
  });

  it('does not invent a time for a step that has not happened yet', () => {
    const steps = publicTimeline(make({ statusKind: 'accepted', acceptedAt: '2026-01-11T09:05:00' }));

    expect(steps.map((s) => s.at)).toEqual(['2026-01-11T09:00:00', '2026-01-11T09:05:00', null, null]);
  });

  it('names the ready step for what the customer chose', () => {
    expect(publicTimeline(make({ fulfillmentType: 'Pickup' }))[2].label).toBe('Ready for pickup');
    expect(publicTimeline(make({ fulfillmentType: 'Delivery' }))[2].label).toBe('Ready for delivery');
    expect(publicTimeline(make({ fulfillmentType: null }))[2].label).toBe('Ready for pickup');
  });

  describe('captions', () => {
    const hints = (order: PublicOrderDto) => publicTimeline(order).map((s) => s.hint);

    it('a waiting order is waiting for the shop, and the rest has not happened', () => {
      expect(hints(make())).toEqual([null, 'Waiting for the shop', 'Not yet', 'Not yet']);
    });

    it('an accepted order is being prepared', () => {
      expect(hints(make({ statusKind: 'accepted' }))).toEqual([null, null, 'Being prepared', 'Not yet']);
    });

    it('a ready order waits for pickup or for delivery', () => {
      expect(hints(make({ statusKind: 'ready', fulfillmentType: 'Pickup' }))).toEqual([
        null,
        null,
        null,
        'Waiting for pickup',
      ]);
      expect(hints(make({ statusKind: 'ready', fulfillmentType: 'Delivery' }))[3]).toBe('Waiting for delivery');
    });

    it('finished and stopped steps need no caption', () => {
      expect(hints(make({ statusKind: 'completed' }))).toEqual([null, null, null, null]);
      expect(hints(make({ statusKind: 'rejected' }))).toEqual([null, null]);
      expect(hints(make({ statusKind: 'cancelled' }))).toEqual([null, null]);
    });
  });

  it('a rejected order stops right after it was placed', () => {
    const steps = publicTimeline(
      make({ statusKind: 'rejected', finishedAt: '2026-01-11T09:02:00' }),
    );
    expect(steps.map((s) => `${s.key}:${s.state}`)).toEqual(['placed:done', 'rejected:stopped']);
    expect(steps[1].at).toBe('2026-01-11T09:02:00');
  });

  it('a cancelled order stops where it was, keeping the steps it reached', () => {
    const steps = publicTimeline(
      make({
        statusKind: 'cancelled',
        acceptedAt: '2026-01-11T09:05:00',
        finishedAt: '2026-01-11T09:30:00',
      }),
    );
    expect(steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      'placed:done',
      'accepted:done',
      'cancelled:stopped',
    ]);
  });

  it('a cancelled order that was never accepted skips straight to cancelled', () => {
    expect(summary(make({ statusKind: 'cancelled' }))).toEqual(['placed:done', 'cancelled:stopped']);
  });

  it('a refunded order shows what happened before the refund', () => {
    const steps = publicTimeline(
      make({
        statusKind: 'refunded',
        acceptedAt: '2026-01-11T09:05:00',
        readyAt: '2026-01-11T09:20:00',
        finishedAt: '2026-01-12T10:00:00',
      }),
    );
    expect(steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      'placed:done',
      'accepted:done',
      'ready:done',
      'refunded:stopped',
    ]);
  });
});

describe('publicStatusNote', () => {
  it('tells a pickup customer to come and get it, and a delivery customer to expect it', () => {
    expect(publicStatusNote(make({ statusKind: 'ready', fulfillmentType: 'Pickup' }))).toContain('pick it up');
    expect(publicStatusNote(make({ statusKind: 'ready', fulfillmentType: 'Delivery' }))).toContain('delivered');
  });
});

describe('ready status styling', () => {
  it('has its own badge color and note color', () => {
    expect(publicStatusVariant('ready')).toBe('warning');
    expect(publicStatusNoteClass('ready')).toContain('orange');
  });
});

describe('publicStatusAccent', () => {
  const kinds = ['waiting', 'accepted', 'ready', 'completed', 'rejected', 'cancelled', 'refunded'] as const;

  it('gives every status its own strip color, with rejected and refunded both red', () => {
    const strips = Object.fromEntries(kinds.map((kind) => [kind, publicStatusAccent(kind).strip]));
    expect(strips).toEqual({
      waiting: 'bg-amber-400',
      accepted: 'bg-sky-400',
      ready: 'bg-orange-400',
      completed: 'bg-emerald-500',
      rejected: 'bg-red-500',
      cancelled: 'bg-slate-300',
      refunded: 'bg-red-500',
    });
  });

  it('colors the payment panel and its total to match', () => {
    expect(publicStatusAccent('refunded').panel).toContain('red');
    expect(publicStatusAccent('refunded').total).toBe('text-red-600');
    expect(publicStatusAccent('completed').total).toBe('text-emerald-700');
  });
});
