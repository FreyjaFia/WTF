// What the anonymous ordering page receives. Deliberately separate from ProductDto and OrderDto: these carry no
// audit fields, staff names or internal ids.

export interface PublicProductDto {
  id: string;
  name: string;
  description?: string | null;
  /** For an add-on this is already the price for the product it belongs to. */
  price: number;
  category: number;
  subCategory?: number | null;
  imageUrl?: string | null;
  addOnCount: number;
}

export interface PublicAddOnGroupDto {
  type: number;
  displayName: string;
  options: PublicProductDto[];
}

/** A discount that is on right now: the product, the exact add-ons it needs and what comes off. */
export interface PublicDealDto {
  productId: string;
  amountOff?: number | null;
  percentOff?: number | null;
  addOns: { addOnProductId: string; quantity: number }[];
  /** How many more items it can discount, or null when it has no usage limit. */
  remaining?: number | null;
  /** The most one order can get at the discounted price, or null when there is no limit per order. */
  maxPerOrder?: number | null;
  /** Rules of one promotion share this key, so their limits are shared too. */
  groupKey?: string | null;
}

export interface PublicCatalogDto {
  products: PublicProductDto[];
  addOnsByProductId: Record<string, PublicAddOnGroupDto[]>;
  /** Missing when talking to an older server. */
  deals?: PublicDealDto[];
}

export interface PublicOrderLinkDto {
  firstName: string;
  address?: string | null;
  /** The customer's saved contact number, offered at checkout. */
  contactNumber?: string | null;
  /** The customer's own profile picture, if they have one. */
  imageUrl?: string | null;
  expiresAt?: string | null;
  catalog: PublicCatalogDto;
}

export type PublicOrderStatusKind =
  | 'waiting'
  | 'accepted'
  | 'ready'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'refunded';

export interface PublicOrderAddOnDto {
  name: string;
  quantity: number;
  unitPrice: number;
  type?: number | null;
}

export interface PublicOrderItemDto {
  name: string;
  quantity: number;
  unitPrice: number;
  addOns: PublicOrderAddOnDto[];
  specialInstructions?: string | null;
  originalPrice?: number | null;
  promoLabel?: string | null;
}

export interface PublicOrderDto {
  id: string;
  orderNumber: number;
  createdAt: string;
  statusLabel: string;
  statusKind: PublicOrderStatusKind;
  rejectionReason?: string | null;
  items: PublicOrderItemDto[];
  total: number;
  fulfillmentType?: 'Pickup' | 'Delivery' | null;
  deliveryAddress?: string | null;
  contactNumber?: string | null;
  paymentMethod?: string | null;
  amountReceived?: number | null;
  tips?: number | null;
  specialInstructions?: string | null;
  /** When staff accepted it. */
  acceptedAt?: string | null;
  /** When it was marked ready for pickup or delivery. */
  readyAt?: string | null;
  /** When it ended: completed, rejected, cancelled or refunded. */
  finishedAt?: string | null;
}

// What the customer sends to place an order. It never carries a price: the server works out every price.

export interface PublicOrderAddOnRequest {
  productId: string;
  quantity: number;
}

export interface PublicOrderItemRequest {
  productId: string;
  quantity: number;
  addOns: PublicOrderAddOnRequest[];
  specialInstructions?: string | null;
}

export interface SubmitPublicOrderRequest {
  items: PublicOrderItemRequest[];
  /** FulfillmentTypeEnum: 0 = Pickup, 1 = Delivery. */
  fulfillment: number;
  deliveryAddress?: string | null;
  contactNumber: string;
  /** PaymentMethodEnum: 1 = Cash, 2 = GCash. */
  paymentMethod: number;
  /** What the customer will pay with, for cash only. It covers the total and the tip. */
  amountReceived?: number | null;
  /** An optional tip for the shop, on top of the total. */
  tips?: number | null;
  specialInstructions?: string | null;
  /** The total the page showed. The shop refuses the order if its own total came out different. */
  expectedTotal?: number | null;
  /** Keep this contact number as the customer's number on file (asked only when it differs from it). */
  saveContactNumber?: boolean;
  /** Keep this delivery address as the customer's address on file (asked only when it differs from it). */
  saveAddress?: boolean;
}

/** A line in the customer's cart. The cart lives in memory only and is never saved on the device. */
export interface PublicCartAddOn {
  id: string;
  name: string;
  /** Price of one. */
  price: number;
  /** How many of this add-on per item (toppings and extras can be added more than once). */
  quantity: number;
  /** AddOnTypeEnum, used to list Size, Flavor and the rest in the same order as everywhere else. */
  type?: number;
}

export interface PublicCartLine {
  key: string;
  productId: string;
  name: string;
  /** The product's own price, without add-ons. */
  price: number;
  imageUrl?: string | null;
  quantity: number;
  addOns: PublicCartAddOn[];
  specialInstructions?: string | null;
}
