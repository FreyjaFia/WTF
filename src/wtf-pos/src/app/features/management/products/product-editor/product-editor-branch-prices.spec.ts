import { ProductCategoryEnum } from '@app/testing/catalog-ids';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AlertService, BranchService, ProductService } from '@core/services';
import { ProductBranchPricesDto, ProductDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductEditorComponent } from './product-editor';

const product = {
  id: 'p1',
  name: 'Latte',
  code: 'LAT',
  description: '',
  price: 160,
  category: ProductCategoryEnum.Drink,
  subCategory: null,
  isAddOn: false,
  isActive: true,
  priceHistory: [],
  createdAt: '2026-10-01T00:00:00Z',
} as unknown as ProductDto;

const prices: ProductBranchPricesDto = {
  productId: 'p1',
  productName: 'Latte',
  shopPrice: 160,
  branches: [
    { branchId: 'b-main', branchName: 'Makati', branchCode: 'MAK', isMain: true, price: null, effectivePrice: 160 },
    { branchId: 'b-bgc', branchName: 'BGC', branchCode: 'BGC', isMain: false, price: 175, effectivePrice: 175 },
  ],
};

describe('ProductEditorComponent: branch prices', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(options: { multi?: boolean; canSeeAll?: boolean; mine?: string[]; id?: string | null; saveFails?: boolean } = {}) {
    const { multi = true, canSeeAll = true, mine = ['b-main', 'b-bgc'], id = 'p1', saveFails = false } = options;
    const products = {
      getProduct: vi.fn(() => of(product)),
      createProduct: vi.fn(() => of({ ...product, id: 'new' })),
      updateProduct: vi.fn(() => of(product)),
      getProducts: vi.fn(() => of([])),
      getProductAddOns: vi.fn(() => of([])),
      getProductAddOnPriceOverrides: vi.fn(() => of([])),
      getProductBranchPrices: vi.fn(() => of(prices)),
      saveProductBranchPrices: vi.fn(() => (saveFails ? throwError(() => new Error('No luck.')) : of(prices))),
      getProductSoldAt: vi.fn(() => of({ productId: 'p1', productName: 'Latte', isAllBranches: true, canChange: true, canSellEverywhere: true, branches: [] })),
    };
    const alerts = { error: vi.fn(), successUpdated: vi.fn(), successCreated: vi.fn() };
    const branches = {
      isMultiBranch: signal(multi),
      canSeeAll: signal(canSeeAll),
      activeBranch: signal(null),
      branches: signal(
        mine.map((branchId) => ({ id: branchId, name: branchId, code: branchId.toUpperCase(), isMain: branchId === 'b-main', isActive: true })),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: products },
        { provide: AlertService, useValue: alerts },
        { provide: BranchService, useValue: branches },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => id } } } },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductEditorComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance as any, products, alerts, el: fixture.nativeElement as HTMLElement };
  }

  it('shows a row for every branch with its own price filled in and the shop price as the hint', () => {
    const { fixture, c, products, el } = setup();

    expect(products.getProductBranchPrices).toHaveBeenCalledWith('p1');
    expect(c.branchPriceRows().map((r: any) => r.code)).toEqual(['MAK', 'BGC']);
    expect(c.branchPriceControl('b-main').value).toBeNull();
    expect(c.branchPriceControl('b-bgc').value).toBe(175);
    expect(el.querySelector('[data-testid="branch-prices-card"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="branch-price-row-MAK"]')?.textContent).toContain('Charges ₱160.00');
    expect(el.querySelector('[data-testid="branch-price-row-MAK"]')?.textContent).toContain('(shop price)');
    expect(el.querySelector('[data-testid="branch-price-row-BGC"]')?.textContent).toContain('Charges ₱175.00');
    fixture.destroy();
  });

  it('shows nothing when the shop has a single branch', () => {
    const { c, products, el } = setup({ multi: false });

    expect(products.getProductBranchPrices).not.toHaveBeenCalled();
    expect(c.branchPriceRows()).toEqual([]);
    expect(el.querySelector('[data-testid="branch-prices-card"]')).toBeNull();
  });

  it('follows the shop price while a branch has none, and shows its own price otherwise', () => {
    const { c } = setup();

    c.productForm.controls.price.setValue(180);
    expect(c.branchEffectivePrice('b-main')).toBe(180);
    expect(c.branchEffectivePrice('b-bgc')).toBe(175);
  });

  it('sends only the branches that changed when the product is saved', () => {
    const { c, products, alerts } = setup();

    c.branchPriceControl('b-main').setValue(165);
    c.clearBranchPrice('b-bgc');
    c.saveProduct();

    expect(products.updateProduct).toHaveBeenCalled();
    expect(products.saveProductBranchPrices).toHaveBeenCalledWith('p1', [
      { branchId: 'b-main', price: 165 },
      { branchId: 'b-bgc', price: null },
    ]);
    expect(alerts.successUpdated).toHaveBeenCalledWith('Product');
  });

  it('does not call the API for branch prices when none changed', () => {
    const { c, products } = setup();

    c.saveProduct();

    expect(products.updateProduct).toHaveBeenCalled();
    expect(products.saveProductBranchPrices).not.toHaveBeenCalled();
  });

  it('reports a failed branch price save without losing the saved product', () => {
    const { c, alerts } = setup({ saveFails: true });

    c.branchPriceControl('b-main').setValue(165);
    c.saveProduct();

    expect(alerts.error).toHaveBeenCalledWith('The product was saved, but its branch prices were not: No luck.');
    expect(alerts.successUpdated).toHaveBeenCalledWith('Product');
  });

  it('refuses to save while a branch price is out of range or has too many decimals', () => {
    const { c, products } = setup();

    for (const bad of [0, -3, 1000000, 10.555]) {
      c.branchPriceControl('b-main').setValue(bad);
      c.saveProduct();
      expect(c.branchPriceForm.invalid).toBe(true);
    }

    expect(products.updateProduct).not.toHaveBeenCalled();
  });

  it('saves the branch prices of a new product once the product exists', () => {
    const { c, products } = setup({ id: null });

    expect(c.branchPriceRows().map((r: any) => r.code)).toEqual(['B-MAIN', 'B-BGC']);
    c.productForm.patchValue({ name: 'Mocha', code: 'MOC1', price: 120, category: ProductCategoryEnum.Drink });
    c.branchPriceControl('b-bgc').setValue(135);
    c.saveProduct();

    expect(products.createProduct).toHaveBeenCalled();
    expect(products.saveProductBranchPrices).toHaveBeenCalledWith('new', [{ branchId: 'b-bgc', price: 135 }]);
  });

  it('keeps the branches of other people locked for someone limited to their own', () => {
    const { c } = setup({ canSeeAll: false, mine: ['b-bgc'] });

    expect(c.branchPriceRows().find((r: any) => r.code === 'MAK').locked).toBe(true);
    expect(c.branchPriceControl('b-main').disabled).toBe(true);
    expect(c.branchPriceControl('b-bgc').enabled).toBe(true);

    c.branchPriceControl('b-bgc').setValue(180);
    c.saveProduct();
    expect((TestBed.inject(ProductService) as any).saveProductBranchPrices).toHaveBeenCalledWith('p1', [{ branchId: 'b-bgc', price: 180 }]);
  });

  it('asks before leaving with an unsaved branch price', () => {
    const { c } = setup();

    expect(c.canDeactivate()).toBe(true);
    c.branchPriceControl('b-main').setValue(165);
    c.branchPriceControl('b-main').markAsDirty();
    expect(c.canDeactivate()).toBeInstanceOf(Promise);
    expect(c.showDiscardModal()).toBe(true);
  });
});
