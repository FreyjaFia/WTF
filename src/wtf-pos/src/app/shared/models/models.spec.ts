import { describe, expect, it } from 'vitest';
import {
  ADD_ON_TYPE_ORDER,
  AddOnTypeEnum,
  OrderStatusEnum,
  PaymentMethodEnum,
  PRODUCT_SUB_CATEGORY_LABELS,
  ProductCategoryEnum,
  ProductSubCategoryEnum,
  PromotionTypeEnum,
  UserRoleEnum,
} from '@shared/models';

describe('model enums and constants', () => {
  it('keeps API-aligned enum values', () => {
    expect(OrderStatusEnum.All).toBe(0);
    expect(OrderStatusEnum.Pending).toBe(1);
    expect(OrderStatusEnum.Completed).toBe(2);
    expect(OrderStatusEnum.Cancelled).toBe(3);
    expect(OrderStatusEnum.Refunded).toBe(4);
    expect(PaymentMethodEnum.Cash).toBe(1);
    expect(PaymentMethodEnum.GCash).toBe(2);
    expect(ProductCategoryEnum.Drink).toBe(1);
    expect(ProductCategoryEnum.Other).toBe(4);
    expect(PromotionTypeEnum.FixedBundle).toBe(1);
    expect(PromotionTypeEnum.MixMatch).toBe(2);
    expect(PromotionTypeEnum.DiscountedProduct).toBe(3);
    expect(UserRoleEnum.Admin).toBe(1);
    expect(UserRoleEnum.Cashier).toBe(2);
    expect(UserRoleEnum.AdminViewer).toBe(3);
    expect(UserRoleEnum.SuperAdmin).toBe(4);
    expect(UserRoleEnum.ItemManager).toBe(5);
    expect(UserRoleEnum.StockManager).toBe(6);
  });

  it('labels every product sub-category', () => {
    expect(PRODUCT_SUB_CATEGORY_LABELS[ProductSubCategoryEnum.Coffee]).toBe('Coffee');
    expect(PRODUCT_SUB_CATEGORY_LABELS[ProductSubCategoryEnum.NonCoffee]).toBe('Non-Coffee');
    expect(PRODUCT_SUB_CATEGORY_LABELS[ProductSubCategoryEnum.Snacks]).toBe('Snacks');
    expect(PRODUCT_SUB_CATEGORY_LABELS[ProductSubCategoryEnum.Retail]).toBe('Retail');
  });

  it('orders add-on types Size, Flavor, Sauce, Topping, Extra', () => {
    const sorted = [
      AddOnTypeEnum.Extra,
      AddOnTypeEnum.Topping,
      AddOnTypeEnum.Sauce,
      AddOnTypeEnum.Flavor,
      AddOnTypeEnum.Size,
    ].sort((a, b) => ADD_ON_TYPE_ORDER[a] - ADD_ON_TYPE_ORDER[b]);
    expect(sorted).toEqual([
      AddOnTypeEnum.Size,
      AddOnTypeEnum.Flavor,
      AddOnTypeEnum.Sauce,
      AddOnTypeEnum.Topping,
      AddOnTypeEnum.Extra,
    ]);
  });

  it('gives each add-on type a unique rank', () => {
    const ranks = Object.values(ADD_ON_TYPE_ORDER);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});
