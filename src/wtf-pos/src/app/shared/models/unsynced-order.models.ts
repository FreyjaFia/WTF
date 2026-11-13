import { PaymentMethodEnum } from './order.models';

export enum UnsyncedOrderStatusEnum {
  Open = 1,
  Resolved = 2,
}

export enum UnsyncedOrderResolutionEnum {
  Retried = 1,
  NoteOnly = 2,
  Discarded = 3,
}

export const UNSYNCED_RESOLUTION_LABELS: Record<UnsyncedOrderResolutionEnum, string> = {
  [UnsyncedOrderResolutionEnum.Retried]: 'Saved after a retry',
  [UnsyncedOrderResolutionEnum.NoteOnly]: 'Saved as a note',
  [UnsyncedOrderResolutionEnum.Discarded]: 'Discarded',
};

export interface UnsyncedOrderDto {
  id: string;
  offlineLocalId: string;
  errorText: string;
  errorCode: string;
  cashierUserId: string;
  cashierName: string | null;
  deviceCreatedAt: string | null;
  receivedAt: string;
  quotedTotal: number | null;
  status: UnsyncedOrderStatusEnum;
  resolution: UnsyncedOrderResolutionEnum | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  discardReason: string | null;
  resultingOrderId: string | null;
  lineCount: number;
}

export interface UnsyncedOrderLineDto {
  productId: string;
  productName: string | null;
  quantity: number;
  quotedPrice: number | null;
  specialInstructions: string | null;
  addOns: UnsyncedOrderLineDto[];
}

export interface UnsyncedOrderDetailDto {
  order: UnsyncedOrderDto;
  lines: UnsyncedOrderLineDto[];
  paymentMethod: PaymentMethodEnum | null;
  amountReceived: number | null;
  changeAmount: number | null;
  tips: number | null;
  note: string | null;
  specialInstructions: string | null;
}

export interface UnsyncedOrderRetryResultDto {
  resolved: boolean;
  error: string | null;
  orderId: string | null;
  orderNumber: number | null;
  order: UnsyncedOrderDto;
}

export interface UnsyncedOrderQuery {
  status?: UnsyncedOrderStatusEnum;
  cashierId?: string;
  fromDate?: string;
  toDate?: string;
  searchTerm?: string;
  sortBy?: string;
  descending?: boolean;
  page?: number;
  pageSize?: number;
}
