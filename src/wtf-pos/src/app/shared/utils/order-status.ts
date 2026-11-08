import type { BadgeVariant } from '@shared/components/badge/badge';
import { OrderStatusEnum } from '@shared/models';

export function orderStatusVariant(status?: OrderStatusEnum | null): BadgeVariant {
  switch (status) {
    case OrderStatusEnum.PendingApproval:
    case OrderStatusEnum.PendingReview:
      return 'amber';
    case OrderStatusEnum.Pending:
      return 'warning';
    case OrderStatusEnum.Completed:
      return 'success';
    case OrderStatusEnum.Cancelled:
      return 'default';
    case OrderStatusEnum.Refunded:
      return 'error';
    default:
      return 'info';
  }
}

export function orderStatusLabel(status?: OrderStatusEnum | null): string {
  switch (status) {
    case OrderStatusEnum.PendingApproval:
      return 'Awaiting approval';
    case OrderStatusEnum.PendingReview:
      return 'Needs review';
    case OrderStatusEnum.Pending:
      return 'Pending';
    case OrderStatusEnum.Completed:
      return 'Completed';
    case OrderStatusEnum.Cancelled:
      return 'Cancelled';
    case OrderStatusEnum.Refunded:
      return 'Refunded';
    default:
      return 'Unknown';
  }
}
