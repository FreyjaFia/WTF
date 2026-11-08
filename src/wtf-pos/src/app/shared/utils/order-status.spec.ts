import { OrderStatusEnum } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { orderStatusLabel, orderStatusVariant } from './order-status';

describe('order status display', () => {
  it.each([
    [OrderStatusEnum.PendingApproval, 'amber', 'Awaiting approval'],
    [OrderStatusEnum.PendingReview, 'amber', 'Needs review'],
    [OrderStatusEnum.Pending, 'warning', 'Pending'],
    [OrderStatusEnum.Completed, 'success', 'Completed'],
    [OrderStatusEnum.Cancelled, 'default', 'Cancelled'],
    [OrderStatusEnum.Refunded, 'error', 'Refunded'],
    [null, 'info', 'Unknown'],
    [undefined, 'info', 'Unknown'],
  ])('status %s is %s and reads %s', (status, variant, label) => {
    expect(orderStatusVariant(status)).toBe(variant);
    expect(orderStatusLabel(status)).toBe(label);
  });
});
