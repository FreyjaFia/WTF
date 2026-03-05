export enum OrderStatusEnum {
  All = 0,
  Pending = 1,
  Completed = 2,
  Cancelled = 3,
  Refunded = 4,
}

export enum PaymentMethodEnum {
  Cash = 1,
  GCash = 2,
}

export interface OrderItemRequestDto {
  productId: string;
  quantity: number;
  addOns: OrderItemRequestDto[];
  specialInstructions?: string | null;
  bundlePromotionId?: string | null;
}

export interface OrderBundlePromotionRequestDto {
  promotionId: string;
  quantity: number;
}

export interface OrderItemDto {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  price?: number | null;
  addOns: OrderItemDto[];
  specialInstructions?: string | null;
  bundlePromotionId?: string | null;
}

export interface OrderBundlePromotionDto {
  promotionId: string;
  promotionName: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderDto {
  id: string;
  orderNumber: number;
  createdAt: string;
  createdBy: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  items: OrderItemDto[];
  customerId?: string | null;
  status: OrderStatusEnum;
  paymentMethod?: PaymentMethodEnum | null;
  amountReceived?: number | null;
  changeAmount?: number | null;
  tips?: number | null;
  specialInstructions?: string | null;
  note?: string | null;
  totalAmount: number;
  customerName?: string | null;
  bundlePromotions?: OrderBundlePromotionDto[] | null;
}

export interface OrderHistoryDto {
  id: string;
  orderNumber: number;
  createdAt: string;
  createdBy: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  customerId?: string | null;
  status: OrderStatusEnum;
  paymentMethod?: PaymentMethodEnum | null;
  amountReceived?: number | null;
  changeAmount?: number | null;
  tips?: number | null;
  specialInstructions?: string | null;
  note?: string | null;
  totalAmount: number;
  customerName?: string | null;
}

export interface CreateOrderCommand {
  customerId?: string | null;
  items: OrderItemRequestDto[];
  bundlePromotions?: OrderBundlePromotionRequestDto[];
  specialInstructions?: string | null;
  status: OrderStatusEnum;
  paymentMethod?: PaymentMethodEnum | null;
  amountReceived?: number | null;
  changeAmount?: number | null;
  tips?: number | null;
  createdAt?: string | null;
  note?: string | null;
}

export interface UpdateOrderCommand {
  id: string;
  customerId?: string | null;
  items: OrderItemRequestDto[];
  bundlePromotions?: OrderBundlePromotionRequestDto[];
  specialInstructions?: string | null;
  status: OrderStatusEnum;
  paymentMethod?: PaymentMethodEnum | null;
  amountReceived?: number | null;
  changeAmount?: number | null;
  tips?: number | null;
  note?: string | null;
}
