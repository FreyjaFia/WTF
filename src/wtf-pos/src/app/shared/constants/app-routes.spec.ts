import { describe, expect, it } from 'vitest';
import { AppRoutes } from './app-routes';

describe('AppRoutes', () => {
  it('exposes static routes', () => {
    expect(AppRoutes.Login).toBe('/login');
    expect(AppRoutes.Dashboard).toBe('/dashboard');
    expect(AppRoutes.OrdersList).toBe('/orders/list');
    expect(AppRoutes.ManagementReports).toBe('/management/reports');
  });

  it('builds parameterised routes', () => {
    expect(AppRoutes.OrderEditorById('a1')).toBe('/orders/editor/a1');
    expect(AppRoutes.OrderDetailsById('a1')).toBe('/orders/details/a1');
    expect(AppRoutes.InventoryItemDetailsById('i')).toBe('/inventory/items/details/i');
    expect(AppRoutes.InventoryItemsEditById('i')).toBe('/inventory/items/edit/i');
    expect(AppRoutes.ManagementProductDetailsById('p')).toBe('/management/products/details/p');
    expect(AppRoutes.ManagementProductEditById('p')).toBe('/management/products/edit/p');
    expect(AppRoutes.ManagementCustomerDetailsById('c')).toBe('/management/customers/details/c');
    expect(AppRoutes.ManagementCustomerEditById('c')).toBe('/management/customers/edit/c');
    expect(AppRoutes.ManagementUserDetailsById('u')).toBe('/management/users/details/u');
    expect(AppRoutes.ManagementUserEditById('u')).toBe('/management/users/edit/u');
  });

  it('builds promotion routes per type', () => {
    expect(AppRoutes.ManagementPromotionFixedBundleDetailsById('x')).toBe(
      '/management/promotions/fixed-bundles/x',
    );
    expect(AppRoutes.ManagementPromotionMixMatchDetailsById('x')).toBe(
      '/management/promotions/mix-match/x',
    );
    expect(AppRoutes.ManagementPromotionDiscountedProductDetailsById('x')).toBe(
      '/management/promotions/discounted-products/x',
    );
    expect(AppRoutes.ManagementPromotionFixedBundleEditById('x')).toBe(
      '/management/promotions/fixed-bundles/x/edit',
    );
    expect(AppRoutes.ManagementPromotionMixMatchEditById('x')).toBe(
      '/management/promotions/mix-match/x/edit',
    );
    expect(AppRoutes.ManagementPromotionDiscountedProductEditById('x')).toBe(
      '/management/promotions/discounted-products/x/edit',
    );
  });

  it('keeps every static route absolute', () => {
    for (const value of Object.values(AppRoutes)) {
      if (typeof value === 'string') {
        expect(value.startsWith('/')).toBe(true);
      }
    }
  });
});
