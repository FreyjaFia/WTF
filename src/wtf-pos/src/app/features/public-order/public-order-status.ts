import { BadgeVariant } from '@shared/components/badge/badge';
import { PublicOrderDto, PublicOrderStatusKind } from '@shared/models';

const VARIANTS: Record<PublicOrderStatusKind, BadgeVariant> = {
  waiting: 'amber',
  accepted: 'info',
  ready: 'warning',
  completed: 'success',
  rejected: 'error',
  cancelled: 'default',
  refunded: 'default',
};

export function publicStatusVariant(kind: PublicOrderStatusKind): BadgeVariant {
  return VARIANTS[kind];
}

/** One plain sentence on where the order stands, so the customer need not read the badge. */
export function publicStatusNote(order: PublicOrderDto): string {
  switch (order.statusKind) {
    case 'waiting':
      return 'Waiting for the shop to confirm your order. This page updates by itself.';
    case 'accepted':
      return 'The shop accepted your order and is preparing it.';
    case 'ready':
      return order.fulfillmentType === 'Delivery'
        ? 'Your order is ready and will be delivered to you.'
        : 'Your order is ready. You can pick it up now.';
    case 'completed':
      return 'This order is complete. Thank you!';
    case 'rejected':
      return order.rejectionReason
        ? `The shop could not take this order. Reason: ${order.rejectionReason}`
        : 'The shop could not take this order.';
    case 'refunded':
      return 'This order was refunded.';
    default:
      return 'This order was cancelled.';
  }
}

export function publicStatusNoteClass(kind: PublicOrderStatusKind): string {
  switch (kind) {
    case 'waiting':
      return 'border border-amber-200 bg-amber-50 text-amber-800';
    case 'accepted':
      return 'border border-sky-200 bg-sky-50 text-sky-800';
    case 'ready':
      return 'border border-orange-200 bg-orange-50 text-orange-800';
    case 'completed':
      return 'border border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'rejected':
      return 'border border-red-200 bg-red-50 text-red-700';
    default:
      return 'border border-gray-200 bg-gray-50 text-gray-700';
  }
}

export type TimelineState = 'done' | 'current' | 'upcoming' | 'stopped';

export interface TimelineStep {
  key: string;
  label: string;
  /** When it happened; null when it has not, or when the shop did not record a time (older orders). */
  at: string | null;
  state: TimelineState;
  /**
   * Plain words under the step while it has no time: what is going on now, or that it has not happened yet. Every
   * step that is not done says so, so "Ready for delivery" further down can never be read as the order's status.
   */
  hint: string | null;
}

/**
 * The steps of an order for the timeline: placed, accepted, ready and completed. An order that ended another way
 * (rejected, cancelled, refunded) stops where it ended, and the steps it never reached are left out.
 */
export function publicTimeline(order: PublicOrderDto): TimelineStep[] {
  const readyLabel =
    order.fulfillmentType === 'Delivery' ? 'Ready for delivery' : 'Ready for pickup';
  const kind = order.statusKind;

  const placed: TimelineStep = {
    key: 'placed',
    label: 'Order placed',
    at: order.createdAt,
    state: 'done',
    hint: null,
  };

  if (kind === 'rejected') {
    return [
      placed,
      {
        key: 'rejected',
        label: 'Rejected',
        at: order.finishedAt ?? null,
        state: 'stopped',
        hint: null,
      },
    ];
  }

  const accepted = kind !== 'waiting' && kind !== 'cancelled';
  const ready = kind === 'ready' || kind === 'completed' || kind === 'refunded';

  if (kind === 'cancelled' || kind === 'refunded') {
    const steps: TimelineStep[] = [placed];
    if (order.acceptedAt) {
      steps.push({
        key: 'accepted',
        label: 'Accepted',
        at: order.acceptedAt,
        state: 'done',
        hint: null,
      });
    }
    if (order.readyAt) {
      steps.push({ key: 'ready', label: readyLabel, at: order.readyAt, state: 'done', hint: null });
    }
    steps.push({
      key: kind,
      label: kind === 'refunded' ? 'Refunded' : 'Cancelled',
      at: order.finishedAt ?? null,
      state: 'stopped',
      hint: null,
    });
    return steps;
  }

  const reached = [true, accepted, ready, kind === 'completed'];
  const steps: TimelineStep[] = [
    placed,
    {
      key: 'accepted',
      label: 'Accepted',
      at: order.acceptedAt ?? null,
      state: 'upcoming',
      hint: null,
    },
    { key: 'ready', label: readyLabel, at: order.readyAt ?? null, state: 'upcoming', hint: null },
    {
      key: 'completed',
      label: 'Completed',
      at: order.finishedAt ?? null,
      state: 'upcoming',
      hint: null,
    },
  ];

  const nowHints: Record<string, string> = {
    accepted: 'Waiting for the shop',
    ready: 'Being prepared',
    completed: order.fulfillmentType === 'Delivery' ? 'Waiting for delivery' : 'Waiting for pickup',
  };

  const next = reached.findIndex((done) => !done);
  return steps.map((step, i) => {
    const state: TimelineState = reached[i] ? 'done' : i === next ? 'current' : 'upcoming';
    return {
      ...step,
      // A step the shop skipped (paid straight from checkout, never marked ready) shows the time of the next step
      // that has one, since that is when the order got past it.
      at: state === 'done' ? (step.at ?? skippedAt(steps, i)) : step.at,
      state,
      hint: state === 'current' ? nowHints[step.key] : state === 'upcoming' ? 'Not yet' : null,
    };
  });
}

function skippedAt(steps: TimelineStep[], index: number): string | null {
  return steps.slice(index + 1).find((step) => step.at)?.at ?? null;
}

export interface StatusAccent {
  /** The thin strip on top of the order card. */
  strip: string;
  panel: string;
  title: string;
  divider: string;
  total: string;
}

/** The colors of an order for each status, the same scheme as the shop screen so the two sides look alike. */
export function publicStatusAccent(kind: PublicOrderStatusKind): StatusAccent {
  switch (kind) {
    case 'waiting':
      return {
        strip: 'bg-amber-400',
        panel: 'border-amber-200 bg-amber-50/50',
        title: 'text-amber-700',
        divider: 'border-amber-300',
        total: 'text-gray-900',
      };
    case 'accepted':
      return {
        strip: 'bg-sky-400',
        panel: 'border-sky-200 bg-sky-50/50',
        title: 'text-sky-700',
        divider: 'border-sky-300',
        total: 'text-gray-900',
      };
    case 'ready':
      return {
        strip: 'bg-orange-400',
        panel: 'border-orange-200 bg-orange-50/50',
        title: 'text-orange-700',
        divider: 'border-orange-300',
        total: 'text-gray-900',
      };
    case 'completed':
      return {
        strip: 'bg-emerald-500',
        panel: 'border-emerald-200 bg-emerald-50/50',
        title: 'text-emerald-700',
        divider: 'border-emerald-300',
        total: 'text-emerald-700',
      };
    case 'rejected':
    case 'refunded':
      return {
        strip: 'bg-red-500',
        panel: 'border-red-200 bg-red-50/50',
        title: 'text-red-700',
        divider: 'border-red-300',
        total: 'text-red-600',
      };
    default:
      return {
        strip: 'bg-slate-300',
        panel: 'border-slate-200 bg-slate-50/70',
        title: 'text-slate-700',
        divider: 'border-slate-300',
        total: 'text-slate-700',
      };
  }
}
