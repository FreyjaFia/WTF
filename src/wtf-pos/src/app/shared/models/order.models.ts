export enum OrderStatusEnum {
  All = 0,
  Pending = 1,
  Completed = 2,
  Cancelled = 3,
  Refunded = 4,
  /** Placed by a customer through their ordering link and waiting for staff to accept or reject it. */
  PendingApproval = 5,
}

/** Where an order came from. */
export enum OrderSourceEnum {
  Pos = 0,
  CustomerLink = 1,
}

/** How a customer link order is handed over. */
export enum FulfillmentTypeEnum {
  Pickup = 0,
  Delivery = 1,
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
  /** Unit price before a discounted-product promotion; null for orders saved before it was captured. */
  originalPrice?: number | null;
  /** Label of the promotion applied to the line when its price was saved. */
  promoLabel?: string | null;
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
  overrideReason?: string | null;
  overriddenAt?: string | null;
  /** POS unless the customer placed the order through their ordering link. */
  source?: OrderSourceEnum;
  fulfillmentType?: FulfillmentTypeEnum | null;
  deliveryAddress?: string | null;
  contactNumber?: string | null;
  /** Why staff rejected a customer link order. */
  rejectionReason?: string | null;
  /** When staff accepted a customer link order. */
  acceptedAt?: string | null;
  /** When staff marked a customer link order ready for pickup or delivery. */
  readyAt?: string | null;
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
  /** Required when correcting a completed order through the override endpoint. */
  overrideReason?: string | null;
}
