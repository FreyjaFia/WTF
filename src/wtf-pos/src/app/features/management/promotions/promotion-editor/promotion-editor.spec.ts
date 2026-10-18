/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AlertService, ModalStackService, ProductService, PromotionService } from '@core/services';
import { BundleItemsSelectorComponent } from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  AddOnTypeEnum,
  DiscountedProductPromotionDto,
  FixedBundlePromotionDto,
  MixMatchPromotionDto,
  ProductCategoryEnum,
  ProductDto,
} from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionEditorComponent } from './promotion-editor';

function prod(id: string, name: string, isAddOn = false): ProductDto {
  return {
    id,
    name,
    code: id.toUpperCase(),
    price: 10,
    category: ProductCategoryEnum.Drink,
    isAddOn,
    isActive: true,
    createdAt: '2024-01-01',
    createdBy: 'u',
    priceHistory: [],
    addOnCount: 0,
    imageUrl: id === 'p1' ? 'http://img/p1.png' : null,
  };
}

const PRODUCTS = [
  prod('p1', 'Latte'),
  prod('p2', 'Bagel'),
  prod('a1', 'Oat milk', true),
  prod('a2', 'Almond milk', true),
  prod('a3', 'Large', true),
];

const ADDON_GROUPS = [
  { type: AddOnTypeEnum.Size, displayName: 'Size', options: [PRODUCTS[4]] },
  { type: AddOnTypeEnum.Extra, displayName: 'Extra', options: [PRODUCTS[2], PRODUCTS[3]] },
];

function fileOf(type: string, size = 10): File {
  const f = new File(['x'], 'a.png', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('PromotionEditorComponent', () => {
  let fixture: ComponentFixture<PromotionEditorComponent>;
  let c: any;
  let promos: Record<string, ReturnType<typeof vi.fn>>;
  let products: Record<string, ReturnType<typeof vi.fn>>;
  let alerts: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(
    opts: { id?: string | null; path?: string; query?: string | null } = {},
  ): void {
    const id = opts.id ?? null;
    const saved = (extra: object = {}): any => ({ id: id ?? 'new', imageUrl: null, ...extra });
    promos = {
      getFixedBundle: vi.fn(() => of(FIXED)),
      getMixMatchPromotion: vi.fn(() => of(MIX)),
      getDiscountedProductPromotion: vi.fn(() => of(DISC)),
      createFixedBundle: vi.fn(() => of(saved())),
      updateFixedBundle: vi.fn(() => of(saved())),
      createMixMatch: vi.fn(() => of(saved())),
      updateMixMatch: vi.fn(() => of(saved())),
      createDiscountedProduct: vi.fn(() => of(saved())),
      updateDiscountedProduct: vi.fn(() => of(saved())),
      uploadPromotionImage: vi.fn(() => of({ promotionId: 'x', imageUrl: 'http://img/up.png' })),
      deletePromotionImage: vi.fn(() => of(undefined)),
    };
    products = {
      getProducts: vi.fn(() => of(PRODUCTS)),
      getProductAddOns: vi.fn(() => of(ADDON_GROUPS)),
    };
    alerts = {};
    for (const m of [
      'error',
      'success',
      'successDeleted',
      'errorInvalidImageType',
      'errorFileTooLarge',
    ]) {
      alerts[m] = vi.fn();
    }
    alerts['getDeleteErrorMessage'] = vi.fn(() => 'del-default');

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PromotionService, useValue: promos },
        { provide: ProductService, useValue: products },
        { provide: AlertService, useValue: alerts },
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
    fixture = TestBed.createComponent(PromotionEditorComponent);
    c = fixture.componentInstance;
  }

  const FIXED: FixedBundlePromotionDto = {
    id: 'f1',
    name: 'Breakfast',
    isActive: true,
    startDate: null,
    endDate: null,
    imageUrl: 'http://img/f.png',
    createdAt: '2024-01-01',
    updatedAt: '2024-03-03',
    bundlePrice: 150,
    items: [{ productId: 'p1', quantity: 2, addOns: [{ addOnProductId: 'a1', quantity: 1 }] }],
  };
  const MIX: MixMatchPromotionDto = {
    id: 'm1',
    name: 'Mix',
    isActive: true,
    startDate: null,
    endDate: null,
    createdAt: '2024-01-01',
    requiredQuantity: 2,
    maxSelectionsPerOrder: 3,
    bundlePrice: 99,
    items: [{ productId: 'p1', addOns: [] }],
  };
  const DISC: DiscountedProductPromotionDto = {
    id: 'd1',
    name: 'Disc',
    isActive: true,
    startDate: null,
    endDate: null,
    imageUrl: 'http://img/d.png',
    items: [
      {
        productId: 'p1',
        percentOff: 20,
        fixedPrice: null,
        addOns: [{ addOnProductId: 'a1', quantity: 1 }],
      },
    ],
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('type resolution and data loading', () => {
    it.each([
      ['mix-match/new', null, 'mix-match'],
      ['fixed-bundles/new', null, 'fixed-bundle'],
      ['discounted-products/new', null, 'discounted-product'],
      ['new', 'mixMatch', 'mix-match'],
      ['new', 'mix-match', 'mix-match'],
      ['new', 'discountedProduct', 'discounted-product'],
      ['new', 'discounted-product', 'discounted-product'],
      ['new', 'x', 'fixed-bundle'],
      ['new', null, 'fixed-bundle'],
    ])('path "%s" query %s -> %s', (path, query, expected) => {
      setup({ path, query });
      fixture.detectChanges();
      expect(c.type()).toBe(expected);
      expect(c.isEditMode()).toBe(false);
      expect(products['getProducts']).toHaveBeenCalledWith({ isActive: true });
      expect(c.isLoading()).toBe(false);
    });

    it('labels types', () => {
      setup();
      expect(c.getPromotionTypeLabel('fixed-bundle')).toBe('Fixed Bundle');
      expect(c.getPromotionTypeLabel('mix-match')).toBe('Mix & Match');
      expect(c.getPromotionTypeLabel('discounted-product')).toBe('Discounted Product');
    });

    it('loads an existing fixed bundle', () => {
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      fixture.detectChanges();
      expect(c.isEditMode()).toBe(true);
      expect(c.fixedBundle().name).toBe('Breakfast');
      expect(c.fixedBundle().items).toHaveLength(1);
      expect(c.currentImageUrl()).toBe('http://img/f.png');
      expect(c.lastUpdatedAt()).toBe('2024-03-03');
      expect(c.currentPromotionName()).toBe('Breakfast');
      expect(products['getProductAddOns']).toHaveBeenCalledWith('p1');
      expect(c.getAllowedAddOnsForFixedBundleItem(0).map((x: ProductDto) => x.id)).toEqual([
        'a3',
        'a1',
        'a2',
      ]);
    });

    it('loads an existing mix & match', () => {
      setup({ id: 'm1', path: 'mix-match/:id/edit' });
      fixture.detectChanges();
      expect(c.mixMatch()).toMatchObject({
        name: 'Mix',
        requiredQuantity: 2,
        maxSelectionsPerOrder: 3,
        bundlePrice: 99,
        imageUrl: null,
      });
      expect(c.lastUpdatedAt()).toBe('2024-01-01');
      expect(c.currentPromotionName()).toBe('Mix');
    });

    it('loads an existing discounted product with percent mode', () => {
      setup({ id: 'd1', path: 'discounted-products/:id/edit' });
      fixture.detectChanges();
      expect(c.discountedProduct().name).toBe('Disc');
      expect(c.discountedProductDiscountType()).toBe('percent');
      expect(c.discountedProductPercentOff()).toBe(20);
      expect(c.discountedProductFixedPrice()).toBeNull();
      expect(c.currentImageUrl()).toBe('http://img/d.png');
      expect(c.currentPromotionName()).toBe('Disc');
    });

    it('loads discounted product in fixed mode when percent is empty', () => {
      setup({ id: 'd1', path: 'discounted-products/:id/edit' });
      promos['getDiscountedProductPromotion'].mockReturnValue(
        of({ ...DISC, items: [{ ...DISC.items[0], percentOff: null, fixedPrice: 5 }] }),
      );
      fixture.detectChanges();
      expect(c.discountedProductDiscountType()).toBe('fixed');
      expect(c.discountedProductFixedPrice()).toBe(5);
    });

    it.each([
      ['fixed-bundles/:id/edit', 'getFixedBundle'],
      ['mix-match/:id/edit', 'getMixMatchPromotion'],
      ['discounted-products/:id/edit', 'getDiscountedProductPromotion'],
    ])('alerts when %s fails to load', (path, method) => {
      setup({ id: 'x', path });
      promos[method].mockReturnValue(throwError(() => new Error('load fail')));
      fixture.detectChanges();
      expect(alerts['error']).toHaveBeenCalledWith('load fail');
      expect(c.isLoading()).toBe(false);
    });

    it('alerts when products fail to load in create mode', () => {
      setup();
      products['getProducts'].mockReturnValue(throwError(() => new Error('p fail')));
      fixture.detectChanges();
      expect(alerts['error']).toHaveBeenCalledWith('p fail');
      expect(c.isLoading()).toBe(false);
    });

    it('add-on group load failure caches empty arrays', () => {
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      products['getProductAddOns'].mockReturnValue(throwError(() => new Error('x')));
      fixture.detectChanges();
      expect(c.allowedAddOnsByProductId()['p1']).toEqual([]);
      expect(c.allowedAddOnGroupsByProductId()['p1']).toEqual([]);
    });
  });

  describe('lookup helpers', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('resolves names, codes, images and main products', () => {
      expect(c.getMainProducts().map((p: ProductDto) => p.id)).toEqual(['p1', 'p2']);
      expect(c.getProductName('p1')).toBe('Latte');
      expect(c.getProductName('zz')).toBe('');
      expect(c.getAddOnName('a1')).toBe('Oat milk');
      expect(c.getAddOnName('zz')).toBe('Unknown add-on');
      expect(c.getProductCode('p2')).toBe('P2');
      expect(c.getProductCode('zz')).toBeNull();
      expect(c.getProductImageUrl('p1')).toBe('http://img/p1.png');
      expect(c.getProductImageUrl('p2')).toBeNull();
    });
  });

  describe('date helpers', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('round trips local datetime input through UTC for each type', () => {
      c.setFixedBundleStartAtUtc('2025-03-04T10:30');
      c.setFixedBundleEndAtUtc('2025-03-05T11:45');
      expect(c.getFixedBundleStartLocal()).toBe('2025-03-04T10:30');
      expect(c.getFixedBundleEndLocal()).toBe('2025-03-05T11:45');
      expect(c.fixedBundle().startDate).toBe(new Date(2025, 2, 4, 10, 30).toISOString());

      c.setMixMatchStartAtUtc('2025-03-04T10:30');
      c.setMixMatchEndAtUtc('2025-03-04T12:00');
      expect(c.getMixMatchStartLocal()).toBe('2025-03-04T10:30');
      expect(c.getMixMatchEndLocal()).toBe('2025-03-04T12:00');

      c.setDiscountedProductStartAtUtc('2025-03-04T01:00');
      c.setDiscountedProductEndAtUtc('2025-03-04T02:00');
      expect(c.getDiscountedProductStartLocal()).toBe('2025-03-04T01:00');
      expect(c.getDiscountedProductEndLocal()).toBe('2025-03-04T02:00');
    });

    it('handles date-only input as local midnight', () => {
      c.setFixedBundleStartAtUtc('2025-03-04');
      expect(c.fixedBundle().startDate).toBe(new Date(2025, 2, 4).toISOString());
      expect(c.getFixedBundleStartLocal()).toBe('2025-03-04T00:00');
    });

    it('handles empty and invalid values', () => {
      c.setFixedBundleStartAtUtc('');
      expect(c.fixedBundle().startDate).toBeNull();
      c.setFixedBundleStartAtUtc('garbage');
      expect(c.fixedBundle().startDate).toBeNull();
      c.fixedBundle.update((s: any) => ({ ...s, startDate: 'not a date' }));
      expect(c.getFixedBundleStartLocal()).toBe('');
      expect(c.getFixedBundleEndLocal()).toBe('');
    });
  });

  describe('fixed bundle building', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('sets simple fields', () => {
      c.setFixedBundleName('Combo');
      c.setFixedBundleIsActive(false);
      c.setFixedBundlePrice(12.5);
      expect(c.fixedBundle()).toMatchObject({ name: 'Combo', isActive: false, bundlePrice: 12.5 });
      c.setFixedBundlePrice(NaN);
      expect(c.fixedBundle().bundlePrice).toBe(0);
    });

    it('adds, edits and removes items', () => {
      c.addFixedBundleItem();
      c.addFixedBundleItem();
      expect(c.fixedBundle().items).toHaveLength(2);
      c.updateFixedBundleItemProduct(0, 'p1');
      expect(c.fixedBundle().items[0].productId).toBe('p1');
      expect(products['getProductAddOns']).toHaveBeenCalledWith('p1');
      c.updateFixedBundleItemQuantity(0, 4);
      expect(c.fixedBundle().items[0].quantity).toBe(4);
      c.updateFixedBundleItemQuantity(0, 0);
      expect(c.fixedBundle().items[0].quantity).toBe(1);
      c.removeFixedBundleItem(1);
      expect(c.fixedBundle().items).toHaveLength(1);
    });

    it('requires a product before adding an add-on line', () => {
      c.addFixedBundleItem();
      c.addFixedBundleItemAddOn(0);
      expect(alerts['error']).toHaveBeenCalledWith('Select a bundle product first.');
      expect(c.fixedBundle().items[0].addOns).toHaveLength(0);
    });

    it('adds, edits and removes add-on lines', () => {
      c.addFixedBundleItem();
      c.updateFixedBundleItemProduct(0, 'p1');
      c.addFixedBundleItemAddOn(0);
      expect(c.fixedBundle().items[0].addOns).toEqual([{ addOnProductId: '', quantity: 1 }]);
      c.updateFixedBundleItemAddOnProduct(0, 0, 'a1');
      c.updateFixedBundleItemAddOnQuantity(0, 0, 3);
      expect(c.fixedBundle().items[0].addOns[0]).toEqual({ addOnProductId: 'a1', quantity: 3 });
      c.updateFixedBundleItemAddOnQuantity(0, 0, 0);
      expect(c.fixedBundle().items[0].addOns[0].quantity).toBe(1);
      c.removeFixedBundleItemAddOn(0, 0);
      expect(c.fixedBundle().items[0].addOns).toEqual([]);
    });

    it('changing the product keeps only add-ons allowed for the new product', () => {
      c.addFixedBundleItem();
      c.updateFixedBundleItemProduct(0, 'p1');
      c.fixedBundle.update((s: any) => ({
        ...s,
        items: [
          {
            ...s.items[0],
            addOns: [
              { addOnProductId: 'a1', quantity: 1 },
              { addOnProductId: 'not-allowed', quantity: 1 },
            ],
          },
        ],
      }));
      c.updateFixedBundleItemProduct(0, 'p1');
      expect(c.fixedBundle().items[0].addOns).toEqual([{ addOnProductId: 'a1', quantity: 1 }]);
    });

    it('manages quantity drafts', () => {
      c.addFixedBundleItem();
      expect(c.getBundleItemQuantityDraft('p1', 5)).toBe('5');
      c.onBundleItemQuantityDraftInput('p1', '3.9');
      expect(c.getBundleItemQuantityDraft('p1', 5)).toBe('3.9');
      c.saveBundleItemQuantity(0, 'p1');
      expect(c.fixedBundle().items[0].quantity).toBe(3);
      expect(c.getBundleItemQuantityDraft('p1', 5)).toBe('3');
      c.onBundleItemQuantityDraftInput('p1', '-4');
      c.saveBundleItemQuantity(0, 'p1');
      expect(c.fixedBundle().items[0].quantity).toBe(1);
      c.onBundleItemQuantityDraftInput('p1', 'abc');
      c.saveBundleItemQuantity(0, 'p1');
      expect(c.fixedBundle().items[0].quantity).toBe(1);
      c.updateFixedBundleItemQuantity(0, 7);
      c.resetBundleItemQuantity(0, 'p1');
      expect(c.fixedBundle().items[0].quantity).toBe(1);
      expect(c.getBundleItemQuantityDraft('p1', 9)).toBe('1');
    });

    it('groups add-ons for display by type order with an Other bucket', () => {
      c.fixedBundle.update((s: any) => ({
        ...s,
        items: [
          {
            productId: 'p1',
            quantity: 1,
            addOns: [
              { addOnProductId: 'a1', quantity: 1 },
              { addOnProductId: 'a2', quantity: 1 },
              { addOnProductId: 'a3', quantity: 1 },
              { addOnProductId: 'ghost', quantity: 1 },
            ],
          },
          { productId: '', quantity: 1, addOns: [] },
        ],
      }));
      c.onBundleItemsSelected([{ productId: 'p1', addOns: c.fixedBundle().items[0].addOns }]);
      const groups = c.getBundleItemAddOnGroups(0);
      expect(groups.map((g: any) => g.typeLabel)).toEqual(['Size', 'Extra', 'Other']);
      expect(groups[1].options.map((o: any) => o.addOnProductId)).toEqual(['a2', 'a1']);
      expect(c.getBundleItemAddOnGroups(5)).toEqual([]);
    });
  });

  describe('bundle item selector integration', () => {
    function selectorOpenSpy(): ReturnType<typeof vi.fn> {
      const cmp = fixture.debugElement.query(By.directive(BundleItemsSelectorComponent))
        .componentInstance as BundleItemsSelectorComponent;
      const spy = vi.fn();
      cmp.open = spy;
      return spy;
    }

    it('opens with only selected, populated items for a fixed bundle', () => {
      setup();
      fixture.detectChanges();
      c.fixedBundle.update((s: any) => ({
        ...s,
        items: [
          { productId: 'p1', quantity: 1, addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
          { productId: '', quantity: 1, addOns: [] },
        ],
      }));
      const spy = selectorOpenSpy();
      c.openBundleItemsSelector();
      expect(spy).toHaveBeenCalledWith(
        [PRODUCTS[0], PRODUCTS[1]],
        [{ productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 1 }] }],
      );
    });

    it('opens with the mix & match and discounted items by type', () => {
      setup({ path: 'mix-match/new' });
      fixture.detectChanges();
      c.mixMatch.update((s: any) => ({ ...s, items: [{ productId: 'p2', addOns: [] }] }));
      let spy = selectorOpenSpy();
      c.openBundleItemsSelector();
      expect(spy.mock.calls[0][1]).toEqual([{ productId: 'p2', addOns: [] }]);

      TestBed.resetTestingModule();
      setup({ path: 'discounted-products/new' });
      fixture.detectChanges();
      c.discountedProduct.update((s: any) => ({
        ...s,
        items: [{ productId: 'p1', addOns: [], fixedPrice: 1, percentOff: null }],
      }));
      spy = selectorOpenSpy();
      c.openBundleItemsSelector();
      expect(spy.mock.calls[0][1]).toEqual([{ productId: 'p1', addOns: [] }]);
    });

    it('fixed bundle selection keeps quantities of existing items and defaults new ones to 1', () => {
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      fixture.detectChanges();
      c.onBundleItemsSelected([
        { productId: 'p1', addOns: [] },
        { productId: 'p2', addOns: [{ addOnProductId: 'a2', quantity: 2 }] },
      ]);
      expect(c.fixedBundle().items).toEqual([
        { productId: 'p1', quantity: 2, addOns: [] },
        { productId: 'p2', quantity: 1, addOns: [{ addOnProductId: 'a2', quantity: 2 }] },
      ]);
      expect(products['getProductAddOns']).toHaveBeenCalledWith('p2');
    });

    it('mix & match selection maps items without quantity', () => {
      setup({ path: 'mix-match/new' });
      fixture.detectChanges();
      c.onBundleItemsSelected([{ productId: 'p1', addOns: [] }]);
      expect(c.mixMatch().items).toEqual([{ productId: 'p1', addOns: [] }]);
    });

    it('discounted selection applies the current pricing to every item', () => {
      setup({ path: 'discounted-products/new' });
      fixture.detectChanges();
      c.setDiscountedProductFixedPrice(8);
      c.onBundleItemsSelected([
        { productId: 'p1', addOns: [] },
        { productId: 'p2', addOns: [] },
      ]);
      expect(c.discountedProduct().items).toEqual([
        { productId: 'p1', addOns: [], fixedPrice: 8, percentOff: null },
        { productId: 'p2', addOns: [], fixedPrice: 8, percentOff: null },
      ]);
    });
  });

  describe('mix & match building', () => {
    beforeEach(() => {
      setup({ path: 'mix-match/new' });
      fixture.detectChanges();
    });

    it('sets fields with sane fallbacks', () => {
      c.setMixMatchName('M');
      c.setMixMatchIsActive(false);
      c.setMixMatchRequiredQuantity(3);
      c.setMixMatchMaxSelectionsPerOrder(5);
      c.setMixMatchBundlePrice(20);
      expect(c.mixMatch()).toMatchObject({
        name: 'M',
        isActive: false,
        requiredQuantity: 3,
        maxSelectionsPerOrder: 5,
        bundlePrice: 20,
      });
      c.setMixMatchRequiredQuantity(0);
      expect(c.mixMatch().requiredQuantity).toBe(1);
      c.setMixMatchBundlePrice(NaN);
      expect(c.mixMatch().bundlePrice).toBe(0);
      c.setMixMatchMaxSelectionsPerOrder(null);
      expect(c.mixMatch().maxSelectionsPerOrder).toBeNull();
    });

    it('removes items and groups add-ons', () => {
      c.onBundleItemsSelected([
        { productId: 'p1', addOns: [{ addOnProductId: 'a3', quantity: 1 }, { addOnProductId: 'a1', quantity: 1 }] },
        { productId: 'p2', addOns: [] },
      ]);
      const groups = c.getMixMatchItemAddOnGroups(0);
      expect(groups.map((g: any) => g.typeLabel)).toEqual(['Size', 'Extra']);
      expect(c.getMixMatchItemAddOnGroups(1)).toEqual([]);
      c.removeMixMatchItem(0);
      expect(c.mixMatch().items.map((i: any) => i.productId)).toEqual(['p2']);
    });
  });

  describe('discounted product building', () => {
    beforeEach(() => {
      setup({ path: 'discounted-products/new' });
      fixture.detectChanges();
      c.onBundleItemsSelected([
        { productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
        { productId: 'p2', addOns: [{ addOnProductId: 'a2', quantity: 1 }] },
      ]);
    });

    it('sets name, dates and active flag', () => {
      c.setDiscountedProductName('D');
      c.setDiscountedProductIsActive(false);
      expect(c.discountedProduct()).toMatchObject({ name: 'D', isActive: false });
    });

    it('fixed price switches mode, clears percent and propagates to items', () => {
      c.setDiscountedProductPercentOff(10);
      expect(c.discountedProductDiscountType()).toBe('percent');
      c.setDiscountedProductFixedPrice(5);
      expect(c.discountedProductDiscountType()).toBe('fixed');
      expect(c.discountedProductPercentOff()).toBeNull();
      expect(c.discountedProduct().items.map((i: any) => [i.fixedPrice, i.percentOff])).toEqual([
        [5, null],
        [5, null],
      ]);
    });

    it('percent off switches mode, clears fixed price and propagates', () => {
      c.setDiscountedProductFixedPrice(5);
      c.setDiscountedProductPercentOff(15);
      expect(c.discountedProductDiscountType()).toBe('percent');
      expect(c.discountedProductFixedPrice()).toBeNull();
      expect(c.discountedProduct().items.every((i: any) => i.percentOff === 15 && i.fixedPrice === null)).toBe(true);
    });

    it('non positive or null values clear the value without switching mode', () => {
      c.setDiscountedProductFixedPrice(5);
      c.setDiscountedProductFixedPrice(0);
      expect(c.discountedProductFixedPrice()).toBeNull();
      c.setDiscountedProductFixedPrice(null);
      expect(c.discountedProductFixedPrice()).toBeNull();
      c.setDiscountedProductPercentOff(-3);
      expect(c.discountedProductPercentOff()).toBeNull();
      c.setDiscountedProductPercentOff(null);
      expect(c.discountedProductPercentOff()).toBeNull();
      expect(c.discountedProductDiscountType()).toBe('fixed');
    });

    it('explicit discount type change nulls the other value', () => {
      c.setDiscountedProductFixedPrice(5);
      c.setDiscountedProductDiscountType('percent');
      expect(c.discountedProductFixedPrice()).toBeNull();
      expect(c.discountedProduct().items[0].fixedPrice).toBeNull();
      c.setDiscountedProductPercentOff(30);
      c.setDiscountedProductDiscountType('fixed');
      expect(c.discountedProductPercentOff()).toBeNull();
      expect(c.discountedProduct().items[0].percentOff).toBeNull();
    });

    it('removes items and groups add-ons', () => {
      expect(c.getDiscountedProductAddOnGroups(0).map((g: any) => g.typeLabel)).toEqual(['Extra']);
      expect(c.getDiscountedProductAddOnGroups(9)).toEqual([]);
      c.removeDiscountedProductItem(0);
      expect(c.discountedProduct().items).toHaveLength(1);
    });
  });

  describe('validation', () => {
    describe('fixed bundle', () => {
      beforeEach(() => {
        setup();
        fixture.detectChanges();
      });

      const expectBlocked = (message: string): void => {
        c.save();
        expect(alerts['error']).toHaveBeenCalledWith(message);
        expect(promos['createFixedBundle']).not.toHaveBeenCalled();
        expect(c.isSaving()).toBe(false);
      };

      it('requires a name', () => {
        c.setFixedBundleName('   ');
        expectBlocked('Promotion name is required.');
      });

      it('requires items', () => {
        c.setFixedBundleName('A');
        expectBlocked('At least one bundle item is required.');
      });

      it('requires a product per item', () => {
        c.setFixedBundleName('A');
        c.addFixedBundleItem();
        expectBlocked('Each bundle item must have a product.');
      });

      it('requires add-ons to be allowed for the product', () => {
        c.setFixedBundleName('A');
        c.onBundleItemsSelected([{ productId: 'p1', addOns: [{ addOnProductId: 'zzz', quantity: 1 }] }]);
        expectBlocked('Bundle add-ons must be linked to the selected bundle item product.');
        c.onBundleItemsSelected([{ productId: 'p1', addOns: [{ addOnProductId: '', quantity: 1 }] }]);
        c.save();
        expect(promos['createFixedBundle']).not.toHaveBeenCalled();
      });
    });

    describe('mix & match', () => {
      beforeEach(() => {
        setup({ path: 'mix-match/new' });
        fixture.detectChanges();
        c.setMixMatchName('M');
        c.onBundleItemsSelected([{ productId: 'p1', addOns: [] }]);
      });

      const expectBlocked = (message: string): void => {
        c.save();
        expect(alerts['error']).toHaveBeenCalledWith(message);
        expect(promos['createMixMatch']).not.toHaveBeenCalled();
      };

      it('requires a name', () => {
        c.setMixMatchName('');
        expectBlocked('Promotion name is required.');
      });

      it('requires positive required quantity', () => {
        c.mixMatch.update((s: any) => ({ ...s, requiredQuantity: 0 }));
        expectBlocked('Required quantity must be greater than zero.');
      });

      it('requires non negative bundle price', () => {
        c.mixMatch.update((s: any) => ({ ...s, bundlePrice: -1 }));
        expectBlocked('Bundle Price must be greater than or equal to zero.');
      });

      it('requires items with products and valid add-ons', () => {
        c.mixMatch.update((s: any) => ({ ...s, items: [] }));
        expectBlocked('At least one mix & match item is required.');
        c.mixMatch.update((s: any) => ({ ...s, items: [{ productId: '', addOns: [] }] }));
        expectBlocked('Each mix & match item must have a product.');
        c.mixMatch.update((s: any) => ({
          ...s,
          items: [{ productId: 'p1', addOns: [{ addOnProductId: 'bad', quantity: 1 }] }],
        }));
        expectBlocked('Mix & match add-ons must be linked to the selected product.');
      });

      it('accepts a zero bundle price', () => {
        c.setMixMatchBundlePrice(0);
        c.save();
        expect(promos['createMixMatch']).toHaveBeenCalled();
      });
    });

    describe('amount off warning', () => {
      beforeEach(() => {
        setup({ path: 'discounted-products/new' });
        fixture.detectChanges();
        c.onBundleItemsSelected([{ productId: 'p1', addOns: [] }]);
      });

      it('warns when the amount off covers the price of a product', () => {
        c.setDiscountedProductFixedPrice(10);
        expect(c.amountOffWarning()).toContain('Latte');
        expect(c.amountOffWarning()).toContain('would be free');
        c.setDiscountedProductFixedPrice(150);
        expect(c.amountOffWarning()).toContain('Latte');
      });

      it('says nothing when the amount off is below the price', () => {
        c.setDiscountedProductFixedPrice(9.99);
        expect(c.amountOffWarning()).toBeNull();
      });

      it('says nothing for a percentage, even 100', () => {
        c.setDiscountedProductPercentOff(100);
        expect(c.amountOffWarning()).toBeNull();
      });

      it('goes away when the amount off is cleared', () => {
        c.setDiscountedProductFixedPrice(50);
        c.setDiscountedProductFixedPrice(null);
        expect(c.amountOffWarning()).toBeNull();
      });
    });

    describe('discounted product', () => {
      beforeEach(() => {
        setup({ path: 'discounted-products/new' });
        fixture.detectChanges();
        c.setDiscountedProductName('D');
        c.setDiscountedProductPercentOff(10);
        c.onBundleItemsSelected([
          { productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
        ]);
      });

      const expectBlocked = (message: string): void => {
        c.save();
        expect(alerts['error']).toHaveBeenCalledWith(message);
        expect(promos['createDiscountedProduct']).not.toHaveBeenCalled();
        expect(c.isSaving()).toBe(false);
      };

      it('requires a name', () => {
        c.setDiscountedProductName(' ');
        expectBlocked('Promotion name is required.');
      });

      it('requires products', () => {
        c.removeDiscountedProductItem(0);
        expectBlocked('Select at least one product for the discounted promotion.');
      });

      it('requires unique products', () => {
        c.discountedProduct.update((s: any) => ({ ...s, items: [...s.items, ...s.items] }));
        expectBlocked('Each discounted product must be unique.');
      });

      it('requires a price or percent', () => {
        c.setDiscountedProductDiscountType('fixed');
        c.setDiscountedProductFixedPrice(null);
        c.setDiscountedProductPercentOff(null);
        expectBlocked('Set an amount off or a percent discount.');
      });

      it('rejects both fixed and percent set together', () => {
        c.discountedProductFixedPrice.set(5);
        c.discountedProductPercentOff.set(10);
        expectBlocked('Choose either an amount off or a percent discount, not both.');
      });

      // Documents current behaviour: the >100 check at promotion-editor.ts:1133 runs, but save
      // proceeds only when valid.
      it('rejects percent greater than 100', () => {
        c.setDiscountedProductPercentOff(101);
        expectBlocked('Percent discount must be less than or equal to 100.');
      });

      it('accepts exactly 100 percent', () => {
        c.setDiscountedProductPercentOff(100);
        c.save();
        expect(promos['createDiscountedProduct']).toHaveBeenCalled();
      });

      it('reports a missing product with the dedicated message', () => {
        c.discountedProduct.update((s: any) => ({
          ...s,
          items: [{ productId: '', addOns: [], fixedPrice: null, percentOff: 10 }],
        }));
        expectBlocked('Each discounted item must have a product.');
      });

      it('lets an item list no add-ons: it is the plain product', () => {
        c.discountedProduct.update((s: any) => ({
          ...s,
          items: [{ productId: 'p1', addOns: [], fixedPrice: null, percentOff: 10 }],
        }));
        c.save();
        expect(promos['createDiscountedProduct']).toHaveBeenCalled();
        expect(alerts['error']).not.toHaveBeenCalled();
      });

      it('requires positive add-on quantities', () => {
        c.discountedProduct.update((s: any) => ({
          ...s,
          items: [{ productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 0 }], percentOff: 10 }],
        }));
        expectBlocked('Add-on quantity must be greater than zero.');
      });

      it('requires add-ons allowed for the product', () => {
        c.discountedProduct.update((s: any) => ({
          ...s,
          items: [{ productId: 'p1', addOns: [{ addOnProductId: 'nope', quantity: 1 }], percentOff: 10 }],
        }));
        expectBlocked('Discounted add-ons must be linked to the selected product.');
      });
    });
  });

  describe('schedule and limit', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
      c.setFixedBundleName('Combo');
      c.setFixedBundlePrice(99);
      c.onBundleItemsSelected([{ productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 1 }] }]);
    });

    const blocked = (message: string): void => {
      c.save();
      expect(alerts['error']).toHaveBeenCalledWith(message);
      expect(promos['createFixedBundle']).not.toHaveBeenCalled();
    };

    it('starts running every day, all day, without a limit', () => {
      expect(c.hasSchedule()).toBe(false);
      for (const day of c.weekdayOptions) {
        expect(c.isDaySelected(day.bit)).toBe(true);
      }
    });

    it('switching a day off and on again goes back to every day', () => {
      c.toggleDay(2);
      expect(c.schedule().daysOfWeek).toBe(125);
      expect(c.isDaySelected(2)).toBe(false);
      expect(c.hasSchedule()).toBe(true);

      c.toggleDay(2);
      expect(c.schedule().daysOfWeek).toBeNull();
    });

    it('does not let the last day be switched off', () => {
      for (const day of c.weekdayOptions.filter((d: { bit: number }) => d.bit !== 8)) {
        c.toggleDay(day.bit);
      }
      expect(c.schedule().daysOfWeek).toBe(8);

      c.toggleDay(8);

      expect(c.schedule().daysOfWeek).toBe(8);
    });

    it('needs both times or neither', () => {
      c.setScheduleTime('startTime', '14:00');
      blocked('Set both a start time and an end time, or neither.');
    });

    it('does not accept the same start and end time', () => {
      c.setScheduleTime('startTime', '14:00');
      c.setScheduleTime('endTime', '14:00');
      blocked('The start time and the end time cannot be the same.');
    });

    it.each([0, -1, 2.5])('rejects a usage limit of %s', (value) => {
      c.setMaxRedemptions(value);
      blocked('The usage limit must be a whole number of 1 or more.');
    });

    it('reads an empty usage limit as no limit', () => {
      c.setMaxRedemptions(10);
      c.setMaxRedemptions('');
      expect(c.schedule().maxRedemptions).toBeNull();
    });

    it('sends the schedule with the promotion', () => {
      c.toggleDay(2);
      c.toggleDay(4);
      c.setScheduleTime('startTime', '14:00');
      c.setScheduleTime('endTime', '17:30');
      c.setMaxRedemptions('50');

      c.save();

      expect(promos['createFixedBundle'].mock.calls[0][0].schedule).toEqual({
        daysOfWeek: 121,
        startTime: '14:00',
        endTime: '17:30',
        maxRedemptions: 50,
        redemptions: 0,
      });
    });

    it('a window past midnight is allowed', () => {
      c.setScheduleTime('startTime', '22:00');
      c.setScheduleTime('endTime', '02:00');

      c.save();

      expect(promos['createFixedBundle']).toHaveBeenCalled();
    });

    it('Clear puts everything back', () => {
      c.toggleDay(2);
      c.setScheduleTime('startTime', '14:00');
      c.setScheduleTime('endTime', '17:00');
      c.setMaxRedemptions(5);

      c.clearSchedule();

      expect(c.hasSchedule()).toBe(false);
      expect(c.schedule()).toEqual({ daysOfWeek: null, startTime: '', endTime: '', maxRedemptions: null });
    });

  });

  describe('loading a saved schedule', () => {
    it('shows the days, hours, limit and uses of the promotion being edited', () => {
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      promos['getFixedBundle'].mockReturnValue(
        of({
          ...FIXED,
          schedule: { daysOfWeek: 10, startTime: '14:00', endTime: '17:00', maxRedemptions: 50, redemptions: 7 },
        }),
      );
      fixture.detectChanges();

      expect(c.schedule()).toEqual({ daysOfWeek: 10, startTime: '14:00', endTime: '17:00', maxRedemptions: 50 });
      expect(c.redemptions()).toBe(7);
      expect(c.isDaySelected(2)).toBe(true);
      expect(c.isDaySelected(8)).toBe(true);
      expect(c.isDaySelected(4)).toBe(false);
    });

    it('keeps the uses when it is saved again', () => {
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      promos['getFixedBundle'].mockReturnValue(
        of({ ...FIXED, schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: 9, redemptions: 4 } }),
      );
      fixture.detectChanges();

      c.save();

      expect(promos['updateFixedBundle'].mock.calls[0][0].schedule).toMatchObject({ maxRedemptions: 9, redemptions: 4 });
    });

    it('a changed schedule counts as an unsaved change', () => {
      setup();
      fixture.detectChanges();
      expect(c.canDeactivate()).toBe(true);

      c.setMaxRedemptions(5);

      expect(c.canDeactivate()).not.toBe(true);
    });

    it('a promotion without a schedule loads as every day, all day', () => {
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      fixture.detectChanges();

      expect(c.hasSchedule()).toBe(false);
    });
  });

  describe('saving', () => {
    it('creates a fixed bundle with the current state, then navigates to details', () => {
      setup();
      fixture.detectChanges();
      c.setFixedBundleName('Combo');
      c.setFixedBundlePrice(99);
      c.onBundleItemsSelected([{ productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 2 }] }]);
      c.save();
      expect(promos['createFixedBundle']).toHaveBeenCalledWith({
        name: 'Combo',
        isActive: true,
        startDate: null,
        endDate: null,
        bundlePrice: 99,
        items: [{ productId: 'p1', quantity: 1, addOns: [{ addOnProductId: 'a1', quantity: 2 }] }],
        schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: null, redemptions: 0 },
      });
      expect(alerts['success']).toHaveBeenCalledWith('Fixed bundle created.');
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        AppRoutes.ManagementPromotionFixedBundleDetailsById('new'),
      );
      expect(c.isSaving()).toBe(false);
      expect(c.canDeactivate()).toBe(true);
    });

    it('updates a fixed bundle including the id', () => {
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      fixture.detectChanges();
      c.setFixedBundleName('Renamed');
      c.save();
      expect(promos['updateFixedBundle']).toHaveBeenCalledTimes(1);
      expect(promos['updateFixedBundle'].mock.calls[0][0]).toMatchObject({ id: 'f1', name: 'Renamed' });
      expect(promos['createFixedBundle']).not.toHaveBeenCalled();
      expect(alerts['success']).toHaveBeenCalledWith('Fixed bundle updated.');
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        AppRoutes.ManagementPromotionFixedBundleDetailsById('f1'),
      );
    });

    it('creates and updates mix & match', () => {
      setup({ path: 'mix-match/new' });
      fixture.detectChanges();
      c.setMixMatchName('M');
      c.setMixMatchRequiredQuantity(2);
      c.onBundleItemsSelected([{ productId: 'p1', addOns: [] }]);
      c.save();
      expect(promos['createMixMatch']).toHaveBeenCalledWith({
        name: 'M',
        isActive: true,
        startDate: null,
        endDate: null,
        requiredQuantity: 2,
        maxSelectionsPerOrder: null,
        bundlePrice: 0,
        items: [{ productId: 'p1', addOns: [] }],
        schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: null, redemptions: 0 },
      });
      expect(alerts['success']).toHaveBeenCalledWith('Mix & Match promotion created.');
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        AppRoutes.ManagementPromotionMixMatchDetailsById('new'),
      );

      TestBed.resetTestingModule();
      setup({ id: 'm1', path: 'mix-match/:id/edit' });
      fixture.detectChanges();
      c.save();
      expect(promos['updateMixMatch'].mock.calls[0][0]).toMatchObject({ id: 'm1', name: 'Mix' });
      expect(alerts['success']).toHaveBeenCalledWith('Mix & Match promotion updated.');
    });

    it('creates a discounted product with normalised pricing on every item (percent)', () => {
      setup({ path: 'discounted-products/new' });
      fixture.detectChanges();
      c.setDiscountedProductName('D');
      c.onBundleItemsSelected([
        { productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
      ]);
      c.setDiscountedProductPercentOff(25);
      c.save();
      const dto = promos['createDiscountedProduct'].mock.calls[0][0];
      expect(dto.items).toEqual([
        {
          productId: 'p1',
          addOns: [{ addOnProductId: 'a1', quantity: 1 }],
          fixedPrice: null,
          percentOff: 25,
        },
      ]);
      expect(alerts['success']).toHaveBeenCalledWith('Discounted product created.');
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        AppRoutes.ManagementPromotionDiscountedProductDetailsById('new'),
      );
    });

    it('creates a discounted product with fixed pricing', () => {
      setup({ path: 'discounted-products/new' });
      fixture.detectChanges();
      c.setDiscountedProductName('D');
      c.onBundleItemsSelected([
        { productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
      ]);
      c.setDiscountedProductFixedPrice(4.5);
      c.save();
      const dto = promos['createDiscountedProduct'].mock.calls[0][0];
      expect(dto.items[0]).toMatchObject({ fixedPrice: 4.5, percentOff: null });
    });

    it('updates a discounted product', () => {
      setup({ id: 'd1', path: 'discounted-products/:id/edit' });
      fixture.detectChanges();
      c.save();
      expect(promos['updateDiscountedProduct'].mock.calls[0][0]).toMatchObject({
        id: 'd1',
        name: 'Disc',
      });
      expect(alerts['success']).toHaveBeenCalledWith('Discounted product updated.');
    });

    it.each([
      ['createFixedBundle', undefined, 'fixed-bundles/new'],
      ['createMixMatch', undefined, 'mix-match/new'],
      ['createDiscountedProduct', undefined, 'discounted-products/new'],
    ])('%s error is reported and saving resets', (method, _x, path) => {
      setup({ path });
      fixture.detectChanges();
      c.setFixedBundleName('A');
      c.setMixMatchName('A');
      c.setDiscountedProductName('A');
      c.onBundleItemsSelected([
        { productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
      ]);
      c.setDiscountedProductPercentOff(10);
      promos[method].mockReturnValue(throwError(() => new Error('server')));
      c.save();
      expect(promos[method]).toHaveBeenCalled();
      expect(alerts['error']).toHaveBeenCalledWith('server');
      expect(c.isSaving()).toBe(false);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it.each([
      ['updateFixedBundle', 'f1', 'fixed-bundles/:id/edit'],
      ['updateMixMatch', 'm1', 'mix-match/:id/edit'],
      ['updateDiscountedProduct', 'd1', 'discounted-products/:id/edit'],
    ])('%s error is reported', (method, id, path) => {
      setup({ id, path });
      fixture.detectChanges();
      promos[method].mockReturnValue(throwError(() => new Error('upd fail')));
      c.save();
      expect(alerts['error']).toHaveBeenCalledWith('upd fail');
      expect(c.isSaving()).toBe(false);
    });

    it('does not save twice while busy', () => {
      setup();
      fixture.detectChanges();
      c.setFixedBundleName('A');
      c.onBundleItemsSelected([{ productId: 'p1', addOns: [] }]);
      const s = new Subject<any>();
      promos['createFixedBundle'].mockReturnValue(s);
      c.save();
      expect(c.isSaving()).toBe(true);
      expect(c.isBusy()).toBe(true);
      c.save();
      expect(promos['createFixedBundle']).toHaveBeenCalledTimes(1);
    });

    it('uploads a pending image after saving, then navigates', () => {
      setup();
      fixture.detectChanges();
      c.setFixedBundleName('A');
      c.onBundleItemsSelected([{ productId: 'p1', addOns: [] }]);
      const file = fileOf('image/png');
      c.selectedFile.set(file);
      c.save();
      expect(promos['uploadPromotionImage']).toHaveBeenCalledWith('new', file);
      expect(c.currentImageUrl()).toBe('http://img/up.png');
      expect(c.selectedFile()).toBeNull();
      expect(c.isUploading()).toBe(false);
      expect(alerts['success']).toHaveBeenCalledWith('Fixed bundle created.');
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('reports an upload failure and leaves the promotion id for retry', () => {
      setup();
      fixture.detectChanges();
      c.setFixedBundleName('A');
      c.onBundleItemsSelected([{ productId: 'p1', addOns: [] }]);
      c.selectedFile.set(fileOf('image/png'));
      promos['uploadPromotionImage'].mockReturnValue(throwError(() => new Error('upload bad')));
      c.save();
      expect(alerts['error']).toHaveBeenCalledWith('upload bad');
      expect(c.isUploading()).toBe(false);
      expect(c.isSaving()).toBe(false);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('switches to edit mode once the promotion has been created', () => {
      setup();
      fixture.detectChanges();
      expect(c.isEditMode()).toBe(false);
      c.setFixedBundleName('A');
      c.onBundleItemsSelected([{ productId: 'p1', addOns: [] }]);
      c.selectedFile.set(fileOf('image/png'));
      promos['uploadPromotionImage'].mockReturnValue(throwError(() => new Error('x')));
      c.save();
      expect(c.isEditMode()).toBe(true);
    });
  });

  describe('cancel and navigation', () => {
    it('cancel in create mode returns to the list', () => {
      setup();
      fixture.detectChanges();
      c.cancel();
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementPromotions);
    });

    it.each([
      ['fixed-bundles/:id/edit', 'f1', AppRoutes.ManagementPromotionFixedBundleDetailsById('f1')],
      ['mix-match/:id/edit', 'm1', AppRoutes.ManagementPromotionMixMatchDetailsById('m1')],
      [
        'discounted-products/:id/edit',
        'd1',
        AppRoutes.ManagementPromotionDiscountedProductDetailsById('d1'),
      ],
    ])('cancel in edit mode (%s) returns to details', (path, id, expected) => {
      setup({ id, path });
      fixture.detectChanges();
      c.cancel();
      expect(router.navigateByUrl).toHaveBeenCalledWith(expected);
    });
  });

  describe('unsaved changes guard', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('allows leaving a pristine editor', () => {
      expect(c.canDeactivate()).toBe(true);
    });

    it('detects edits and resolves true on discard', async () => {
      c.setFixedBundleName('changed');
      const result = c.canDeactivate() as Promise<boolean>;
      expect(c.showDiscardModal()).toBe(true);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(true);
      c.confirmDiscard();
      await expect(result).resolves.toBe(true);
      expect(c.showDiscardModal()).toBe(false);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('resolves false on cancel, also via the modal stack', async () => {
      c.setFixedBundleName('changed');
      const first = c.canDeactivate() as Promise<boolean>;
      c.cancelDiscard();
      await expect(first).resolves.toBe(false);
      const second = c.canDeactivate() as Promise<boolean>;
      TestBed.inject(ModalStackService).pop();
      await expect(second).resolves.toBe(false);
    });

    it('treats a pending image or reverting an edit correctly', () => {
      c.selectedFile.set(fileOf('image/png'));
      const p = c.canDeactivate();
      expect(p).toBeInstanceOf(Promise);
      c.cancelDiscard();
      c.selectedFile.set(null);
      expect(c.canDeactivate()).toBe(true);
    });

    it('confirm/cancel without pending prompt are safe', () => {
      c.confirmDiscard();
      c.cancelDiscard();
      expect(c.showDiscardModal()).toBe(false);
    });

    it('after loading an existing promotion it is pristine until modified', () => {
      TestBed.resetTestingModule();
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      fixture.detectChanges();
      expect(c.canDeactivate()).toBe(true);
      c.setFixedBundlePrice(1);
      expect(c.canDeactivate()).toBeInstanceOf(Promise);
    });
  });

  describe('image handling', () => {
    beforeEach(() => {
      setup({ id: 'f1', path: 'fixed-bundles/:id/edit' });
      fixture.detectChanges();
    });

    it.each(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'])(
      'accepts %s and builds a preview',
      async (type) => {
        const f = fileOf(type);
        c.onFileSelected({ target: { files: [f] } } as unknown as Event);
        expect(c.selectedFile()).toBe(f);
        await vi.waitFor(() => expect(c.imagePreview()).toContain('data:'));
      },
    );

    it('rejects invalid type, oversized, and empty selections', () => {
      c.onFileSelected({ target: { files: [fileOf('text/plain')] } } as unknown as Event);
      expect(alerts['errorInvalidImageType']).toHaveBeenCalled();
      c.onFileSelected({ target: { files: [fileOf('image/png', 5 * 1024 * 1024 + 1)] } } as unknown as Event);
      expect(alerts['errorFileTooLarge']).toHaveBeenCalled();
      c.onFileSelected({ target: { files: [] } } as unknown as Event);
      c.onFileSelected({ target: { files: null } } as unknown as Event);
      expect(c.selectedFile()).toBeNull();
    });

    it('removeImage clears selection and file inputs', () => {
      const input = document.createElement('input');
      input.id = 'promotionImage';
      document.body.appendChild(input);
      c.selectedFile.set(fileOf('image/png'));
      c.imagePreview.set('data:x');
      c.removeImage();
      expect(c.selectedFile()).toBeNull();
      expect(c.imagePreview()).toBeNull();
      input.remove();
    });

    it('removeCurrentImage deletes it', () => {
      c.removeCurrentImage();
      expect(promos['deletePromotionImage']).toHaveBeenCalledWith('f1');
      expect(c.currentImageUrl()).toBeNull();
      expect(alerts['successDeleted']).toHaveBeenCalledWith('Image');
      expect(c.isDeletingImage()).toBe(false);
    });

    it('removeCurrentImage reports errors with fallback message', () => {
      promos['deletePromotionImage'].mockReturnValue(throwError(() => new Error('')));
      c.removeCurrentImage();
      expect(alerts['error']).toHaveBeenCalledWith('del-default');
      expect(c.currentImageUrl()).toBe('http://img/f.png');
      promos['deletePromotionImage'].mockReturnValue(throwError(() => new Error('srv')));
      c.removeCurrentImage();
      expect(alerts['error']).toHaveBeenLastCalledWith('srv');
    });

    it('removeCurrentImage is a no-op without image or while deleting', () => {
      c.isDeletingImage.set(true);
      c.removeCurrentImage();
      c.isDeletingImage.set(false);
      c.currentImageUrl.set(null);
      c.removeCurrentImage();
      expect(promos['deletePromotionImage']).not.toHaveBeenCalled();
    });

    it('removeCurrentImage is a no-op in create mode', () => {
      TestBed.resetTestingModule();
      setup();
      fixture.detectChanges();
      c.currentImageUrl.set('x');
      c.removeCurrentImage();
      expect(promos['deletePromotionImage']).not.toHaveBeenCalled();
    });

    describe('drag and drop', () => {
      function dropEvent(file?: File): DragEvent {
        return {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          dataTransfer: { files: file ? [file] : [] },
        } as unknown as DragEvent;
      }

      it('tracks dragging state', () => {
        c.onDragOver(dropEvent());
        expect(c.isDragging()).toBe(true);
        c.onDragLeave(dropEvent());
        expect(c.isDragging()).toBe(false);
      });

      it('accepts valid drops and validates type/size/empty', async () => {
        c.isDragging.set(true);
        const f = fileOf('image/gif');
        c.onFileDrop(dropEvent(f));
        expect(c.isDragging()).toBe(false);
        expect(c.selectedFile()).toBe(f);
        await vi.waitFor(() => expect(c.imagePreview()).toContain('data:'));

        c.selectedFile.set(null);
        c.onFileDrop(dropEvent(fileOf('text/plain')));
        expect(alerts['errorInvalidImageType']).toHaveBeenCalled();
        c.onFileDrop(dropEvent(fileOf('image/png', 9 * 1024 * 1024)));
        expect(alerts['errorFileTooLarge']).toHaveBeenCalled();
        c.onFileDrop(dropEvent());
        expect(c.selectedFile()).toBeNull();
      });
    });
  });

  it('renders the editor template for each type without errors', () => {
    for (const path of ['fixed-bundles/new', 'mix-match/new', 'discounted-products/new']) {
      TestBed.resetTestingModule();
      setup({ path });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-bundle-items-selector')).not.toBeNull();
    }
  });
});
