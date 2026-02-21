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
}

export interface OrderItemDto {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  price?: number | null;
  addOns: OrderItemDto[];
  specialInstructions?: string | null;
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
  totalAmount: number;
}

export interface CreateOrderCommand {
  customerId?: string | null;
  items: OrderItemRequestDto[];
  specialInstructions?: string | null;
  status: OrderStatusEnum;
  paymentMethod?: PaymentMethodEnum | null;
  amountReceived?: number | null;
  changeAmount?: number | null;
  tips?: number | null;
}

export interface UpdateOrderCommand {
  id: string;
  customerId?: string | null;
  items: OrderItemRequestDto[];
  specialInstructions?: string | null;
  status: OrderStatusEnum;
  paymentMethod?: PaymentMethodEnum | null;
  amountReceived?: number | null;
  changeAmount?: number | null;
  tips?: number | null;
}
