import { AddOnTypeEnum } from './product.models';

export interface CartAddOnDto {
  addOnId: string;
  name: string;
  price: number;
  addOnType?: AddOnTypeEnum;
}

export interface CartItemDto {
  productId: string;
  name: string;
  price: number;
  qty: number;
  imageUrl?: string | null;
  addOns?: CartAddOnDto[];
  specialInstructions?: string | null;
}
