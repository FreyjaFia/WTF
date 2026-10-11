/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import {
  AlertService,
  AuthService,
  ModalStackService,
  ProductService,
  PromotionService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  AddOnTypeEnum,
  DiscountedProductPromotionDto,
  FixedBundlePromotionDto,
  MixMatchPromotionDto,
  ProductCategoryEnum,
  ProductDto,
} from '@shared/models';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionDetailsComponent } from './promotion-details';

function prod(id: string, name: string): ProductDto {
  return {
    id,
    name,
    code: id.toUpperCase(),
    price: 10,
    category: ProductCategoryEnum.Drink,
    isAddOn: false,
    isActive: true,
    createdAt: '2024-01-01',
    createdBy: 'u',
    priceHistory: [],
    addOnCount: 0,
  };
}

const PRODUCTS = [
  prod('p1', 'Latte'),
  prod('p2', 'Bagel'),
  prod('a1', 'Oat milk'),
  prod('a2', 'Almond milk'),
  prod('a3', 'Large'),
];

const FIXED: FixedBundlePromotionDto = {
  id: 'f1',
  name: 'Breakfast',
  isActive: true,
  startDate: null,
  endDate: null,
  imageUrl: 'http://img',
  createdAt: '2024-01-01',
  updatedAt: '2024-02-02',
  bundlePrice: 150,
  items: [
    {
      productId: 'p1',
      quantity: 1,
      addOns: [
        { addOnProductId: 'a1', quantity: 1 },
        { addOnProductId: 'a2', quantity: 1 },
        { addOnProductId: 'a3', quantity: 1 },
        { addOnProductId: 'unknown', quantity: 1 },
      ],
    },
    { productId: 'p2', quantity: 1, addOns: [] },
  ],
};

const MIX: MixMatchPromotionDto = {
  id: 'm1',
  name: 'Mix',
  isActive: false,
  startDate: null,
  endDate: null,
  createdAt: '2024-01-01',
  requiredQuantity: 2,
  maxSelectionsPerOrder: null,
  bundlePrice: 99,
  items: [{ productId: 'p1', addOns: [] }],
};

const DISC: DiscountedProductPromotionDto = {
  id: 'd1',
  name: 'Disc',
  isActive: true,
  startDate: null,
  endDate: null,
  createdAt: '2024-01-01',
  items: [
    { productId: 'p1', fixedPrice: 7, addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
    { productId: 'p2', percentOff: 10, addOns: [{ addOnProductId: 'a2', quantity: 1 }] },
  ],
};

describe('PromotionDetailsComponent', () => {
  let fixture: ComponentFixture<PromotionDetailsComponent>;
  let c: any;
  let promos: Record<string, ReturnType<typeof vi.fn>>;
  let products: Record<string, ReturnType<typeof vi.fn>>;
  let alerts: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(opts: { id?: string | null; path?: string; query?: string | null; canWrite?: boolean } = {}): void {
    const id = opts.id === undefined ? 'f1' : opts.id;
    promos = {
      getFixedBundle: vi.fn(() => of(FIXED)),
      getMixMatchPromotion: vi.fn(() => of(MIX)),
      getDiscountedProductPromotion: vi.fn(() => of(DISC)),
      deleteFixedBundle: vi.fn(() => of(undefined)),
      deleteMixMatch: vi.fn(() => of(undefined)),
      deleteDiscountedProduct: vi.fn(() => of(undefined)),
      restorePromotion: vi.fn(() => of(undefined)),
    };
    products = {
      getProducts: vi.fn(() => of(PRODUCTS)),
      getProductAddOns: vi.fn(() =>
        of([
          {
            type: AddOnTypeEnum.Size,
            displayName: 'Size',
            options: [prod('a3', 'Large')],
          },
          {
            type: AddOnTypeEnum.Extra,
            displayName: 'Extra',
            options: [prod('a1', 'Oat milk'), prod('a2', 'Almond milk')],
          },
        ]),
      ),
    };
    alerts = {
      error: vi.fn(),
      errorUnauthorized: vi.fn(),
      successDeleted: vi.fn(),
      successRestored: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PromotionService, useValue: promos },
        { provide: ProductService, useValue: products },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canWritePromotions: () => opts.canWrite ?? true } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => id },
              routeConfig: { path: opts.path ?? '' },
              queryParamMap: { get: () => opts.query ?? null },
            },
          },
        },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(PromotionDetailsComponent);
    c = fixture.componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('redirects to the list when there is no id', () => {
    setup({ id: null });
    fixture.detectChanges();
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementPromotions);
    expect(promos['getFixedBundle']).not.toHaveBeenCalled();
  });

  describe('type resolution', () => {
    it.each([
      ['mix-match/:id', null, 'mix-match'],
      ['fixed-bundles/:id', null, 'fixed-bundle'],
      ['discounted-products/:id', null, 'discounted-product'],
      ['', 'mix-match', 'mix-match'],
      ['', 'mixMatch', 'mix-match'],
      ['', 'discounted-product', 'discounted-product'],
      ['', 'discountedProduct', 'discounted-product'],
      ['', 'other', 'fixed-bundle'],
      ['', null, 'fixed-bundle'],
    ])('path "%s" query %s resolves to %s', (path, query, expected) => {
      setup({ path, query });
      fixture.detectChanges();
      expect(c.type()).toBe(expected);
    });
  });

  describe('fixed bundle', () => {
    beforeEach(() => {
      setup({ path: 'fixed-bundles/:id' });
      fixture.detectChanges();
    });

    it('loads products and the bundle, and primes add-on groups per product', () => {
      expect(promos['getFixedBundle']).toHaveBeenCalledWith('f1');
      expect(c.fixedBundle()).toEqual(FIXED);
      expect(c.mixMatch()).toBeNull();
      expect(c.promotionName()).toBe('Breakfast');
      expect(c.heroLabel()).toBe('Breakfast');
      expect(c.heroImageUrl()).toBe('http://img');
      expect(c.headlinePrice()).toBe(150);
      expect(c.isActive()).toBe(true);
      expect(c.lastUpdatedAt()).toBe('2024-02-02');
      expect(c.isLoading()).toBe(false);
      expect(products['getProductAddOns']).toHaveBeenCalledTimes(2);
      expect(fixture.nativeElement.textContent).toContain('Breakfast');
    });

    it('groups add-ons by type order, then names, with an Other bucket last', () => {
      const groups = c.getGroupedItemAddOns(FIXED.items[0]);
      expect(groups.map((g: any) => g.typeLabel)).toEqual(['Size', 'Extra', 'Other']);
      expect(groups[1].options.map((o: any) => o.addOnProductId)).toEqual(['a2', 'a1']);
    });

    it('returns no groups for items without add-ons', () => {
      expect(c.getGroupedItemAddOns(FIXED.items[1])).toEqual([]);
      expect(c.getGroupedItemAddOns({ productId: '', quantity: 1, addOns: FIXED.items[0].addOns })).toEqual([]);
    });

    it('resolves product names with a fallback', () => {
      expect(c.getProductName('p1')).toBe('Latte');
      expect(c.getProductName('nope')).toBe('Unknown product');
    });

    it('navigates to edit and back', () => {
      c.navigateToEdit();
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        AppRoutes.ManagementPromotionFixedBundleEditById('f1'),
      );
      c.goBack();
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementPromotions);
    });

    it('delete uses the fixed bundle endpoint and returns to the list', () => {
      const stack = TestBed.inject(ModalStackService);
      c.deletePromotion();
      expect(c.showDeleteModal()).toBe(true);
      expect(stack.hasOpen()).toBe(true);
      c.confirmDelete();
      expect(promos['deleteFixedBundle']).toHaveBeenCalledWith('f1');
      expect(alerts['successDeleted']).toHaveBeenCalledWith('Promotion');
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementPromotions);
      expect(c.showDeleteModal()).toBe(false);
      expect(stack.hasOpen()).toBe(false);
    });

    it('delete error is reported and modal stays open', () => {
      promos['deleteFixedBundle'].mockReturnValue(throwError(() => new Error('no')));
      c.deletePromotion();
      c.confirmDelete();
      expect(alerts['error']).toHaveBeenCalledWith('no');
      expect(c.isDeleting()).toBe(false);
      expect(c.showDeleteModal()).toBe(true);
    });

    it('cancelDelete closes unless deleting', () => {
      c.deletePromotion();
      c.isDeleting.set(true);
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(true);
      c.confirmDelete();
      expect(promos['deleteFixedBundle']).not.toHaveBeenCalled();
      c.isDeleting.set(false);
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(false);
    });

    it('restore flow reloads the promotion', () => {
      c.restorePromotion();
      expect(c.showRestoreModal()).toBe(true);
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(false);
      c.restorePromotion();
      c.confirmRestore();
      expect(promos['restorePromotion']).toHaveBeenCalledWith('f1');
      expect(alerts['successRestored']).toHaveBeenCalledWith('Promotion');
      expect(promos['getFixedBundle']).toHaveBeenCalledTimes(2);
      expect(c.showRestoreModal()).toBe(false);
    });

    it('restore error is reported; re-entry guarded', () => {
      promos['restorePromotion'].mockReturnValue(throwError(() => new Error('r')));
      c.restorePromotion();
      c.confirmRestore();
      expect(alerts['error']).toHaveBeenCalledWith('r');
      expect(c.isRestoring()).toBe(false);
      c.isRestoring.set(true);
      c.cancelRestore();
      c.confirmRestore();
      expect(c.showRestoreModal()).toBe(true);
      expect(promos['restorePromotion']).toHaveBeenCalledTimes(1);
    });
  });

  describe('mix & match', () => {
    beforeEach(() => {
      setup({ path: 'mix-match/:id', id: 'm1' });
      fixture.detectChanges();
    });

    it('loads the mix & match promotion only', () => {
      expect(promos['getMixMatchPromotion']).toHaveBeenCalledWith('m1');
      expect(promos['getFixedBundle']).not.toHaveBeenCalled();
      expect(c.promotionName()).toBe('Mix');
      expect(c.headlinePrice()).toBe(99);
      expect(c.isActive()).toBe(false);
      expect(c.heroImageUrl()).toBeNull();
      expect(c.lastUpdatedAt()).toBe('2024-01-01');
    });

    it('groups add-ons and routes edit/delete to mix & match', () => {
      expect(
        c.getGroupedMixMatchItemAddOns({ productId: 'p1', addOns: [{ addOnProductId: 'a3', quantity: 1 }] }),
      ).toHaveLength(1);
      c.navigateToEdit();
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        AppRoutes.ManagementPromotionMixMatchEditById('m1'),
      );
      c.deletePromotion();
      c.confirmDelete();
      expect(promos['deleteMixMatch']).toHaveBeenCalledWith('m1');
    });
  });

  describe('discounted product', () => {
    beforeEach(() => {
      setup({ path: 'discounted-products/:id', id: 'd1' });
      fixture.detectChanges();
    });

    it('exposes primary item, headline price and add-on count', () => {
      expect(promos['getDiscountedProductPromotion']).toHaveBeenCalledWith('d1');
      expect(c.getDiscountedPrimaryItem()).toBe(DISC.items[0]);
      expect(c.headlinePrice()).toBe(7);
      expect(c.getDiscountedAddOnCount()).toBe(2);
      expect(c.promotionName()).toBe('Disc');
    });

    it('groups discounted add-ons and handles missing item', () => {
      expect(c.getGroupedDiscountedAddOns(DISC.items[0])).toHaveLength(1);
      expect(c.getGroupedDiscountedAddOns(null)).toEqual([]);
    });

    it('routes edit/delete to discounted-product endpoints', () => {
      c.navigateToEdit();
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        AppRoutes.ManagementPromotionDiscountedProductEditById('d1'),
      );
      c.deletePromotion();
      c.confirmDelete();
      expect(promos['deleteDiscountedProduct']).toHaveBeenCalledWith('d1');
    });

    it('defaults when there is no promotion data', () => {
      c.discountedProduct.set(null);
      expect(c.getDiscountedPrimaryItem()).toBeNull();
      expect(c.getDiscountedAddOnCount()).toBe(0);
      expect(c.headlinePrice()).toBe(0);
      expect(c.isActive()).toBe(false);
      expect(c.promotionName()).toBe('');
      expect(c.lastUpdatedAt()).toBeNull();
    });
  });

  it('add-on group load failures fall back to an empty group', () => {
    setup();
    products['getProductAddOns'].mockReturnValue(throwError(() => new Error('x')));
    fixture.detectChanges();
    expect(c.addOnGroupsByProductId()['p1']).toEqual([]);
    expect(c.getGroupedItemAddOns(FIXED.items[0])[0].typeLabel).toBe('Other');
  });

  it('does not re-fetch add-on groups already cached', () => {
    setup();
    fixture.detectChanges();
    products['getProductAddOns'].mockClear();
    c.confirmRestore();
    expect(products['getProductAddOns']).not.toHaveBeenCalled();
  });

  it('load failure alerts and redirects to the list', () => {
    setup();
    promos['getFixedBundle'].mockReturnValue(throwError(() => new Error('gone')));
    fixture.detectChanges();
    expect(alerts['error']).toHaveBeenCalledWith('gone');
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementPromotions);
    expect(c.isLoading()).toBe(false);
  });

  it('products load failure also alerts and redirects', () => {
    setup();
    products['getProducts'].mockReturnValue(throwError(() => new Error('prod fail')));
    fixture.detectChanges();
    expect(alerts['error']).toHaveBeenCalledWith('prod fail');
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementPromotions);
  });

  it('rejects write actions without permission', () => {
    setup({ canWrite: false });
    fixture.detectChanges();
    c.deletePromotion();
    c.restorePromotion();
    c.confirmDelete();
    c.confirmRestore();
    expect(alerts['errorUnauthorized']).toHaveBeenCalledTimes(4);
    expect(c.showDeleteModal()).toBe(false);
    expect(promos['deleteFixedBundle']).not.toHaveBeenCalled();
    expect(promos['restorePromotion']).not.toHaveBeenCalled();
  });
});
