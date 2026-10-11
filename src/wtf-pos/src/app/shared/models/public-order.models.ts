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

export interface PublicCatalogDto {
  products: PublicProductDto[];
  addOnsByProductId: Record<string, PublicAddOnGroupDto[]>;
}

export interface PublicOrderLinkDto {
  firstName: string;
  address?: string | null;
  /** The customer's own profile picture, if they have one. */
  imageUrl?: string | null;
  expiresAt?: string | null;
  catalog: PublicCatalogDto;
}

export type PublicOrderStatusKind =
  | 'waiting'
  | 'accepted'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'refunded';

export interface PublicOrderAddOnDto {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface PublicOrderItemDto {
  name: string;
  quantity: number;
  unitPrice: number;
  addOns: PublicOrderAddOnDto[];
  specialInstructions?: string | null;
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
  specialInstructions?: string | null;
}

/** A line in the customer's cart. The cart lives in memory only and is never saved on the device. */
export interface PublicCartAddOn {
  id: string;
  name: string;
  /** Price of one. */
  price: number;
  /** How many of this add-on per item (toppings and extras can be added more than once). */
  quantity: number;
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
