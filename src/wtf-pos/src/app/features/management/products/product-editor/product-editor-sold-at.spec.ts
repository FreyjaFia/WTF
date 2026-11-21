import { ProductCategoryEnum } from '@app/testing/catalog-ids';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AlertService, BranchService, ProductService } from '@core/services';
import { ProductDto, ProductSoldAtDto } from '@shared/models';
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

function soldAtFor(options: { all: boolean; sold?: string[]; canChange?: boolean; canSellEverywhere?: boolean }): ProductSoldAtDto {
  const { all, sold = [], canChange = true, canSellEverywhere = true } = options;
  return {
    productId: 'p1',
    productName: 'Latte',
    isAllBranches: all,
    canChange,
    canSellEverywhere,
    branches: [
      { branchId: 'b-main', branchName: 'Makati', branchCode: 'MAK', isMain: true, isSoldHere: all || sold.includes('b-main') },
      { branchId: 'b-bgc', branchName: 'BGC', branchCode: 'BGC', isMain: false, isSoldHere: all || sold.includes('b-bgc') },
    ],
  };
}

describe('ProductEditorComponent: sold at', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(
    options: { multi?: boolean; canSeeAll?: boolean; mine?: string[]; id?: string | null; soldAt?: ProductSoldAtDto; saveFails?: boolean } = {},
  ) {
    const { multi = true, canSeeAll = true, mine = ['b-main', 'b-bgc'], id = 'p1', soldAt = soldAtFor({ all: true }), saveFails = false } = options;
    const products = {
      getProduct: vi.fn(() => of(product)),
      createProduct: vi.fn((_dto: unknown) => of({ ...product, id: 'new' })),
      updateProduct: vi.fn(() => of(product)),
      getProducts: vi.fn(() => of([])),
      getProductAddOns: vi.fn(() => of([])),
      getProductAddOnPriceOverrides: vi.fn(() => of([])),
      getProductBranchPrices: vi.fn(() => of({ productId: 'p1', productName: 'Latte', shopPrice: 160, branches: [] })),
      saveProductBranchPrices: vi.fn(() => of(null)),
      getProductSoldAt: vi.fn(() => of(soldAt)),
      saveProductSoldAt: vi.fn(() => (saveFails ? throwError(() => new Error('No luck.')) : of(soldAt))),
    };
    const alerts = { error: vi.fn(), successUpdated: vi.fn(), successCreated: vi.fn() };
    const branchList = mine.map((branchId) => ({
      id: branchId,
      name: branchId === 'b-main' ? 'Makati' : 'BGC',
      code: branchId === 'b-main' ? 'MAK' : 'BGC',
      isMain: branchId === 'b-main',
      isActive: true,
    }));
    const branches = {
      isMultiBranch: signal(multi),
      canSeeAll: signal(canSeeAll),
      branches: signal(branchList),
      activeBranch: signal(branchList[branchList.length - 1] ?? null),
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

  it('shows "Every branch" for a product with no limit', () => {
    const { fixture, c, products, el } = setup();
    fixture.detectChanges();

    expect(products.getProductSoldAt).toHaveBeenCalledWith('p1');
    expect(c.soldAtMode()).toBe('all');
    expect(el.querySelector('[data-testid="sold-at-card"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="sold-at-summary"]')?.textContent).toContain('Every branch');
    expect(c.soldAtDirty()).toBe(false);
  });

  it('lists the chosen branches of a limited product', () => {
    const { fixture, c, el } = setup({ soldAt: soldAtFor({ all: false, sold: ['b-bgc'] }) });
    fixture.detectChanges();

    expect(c.soldAtMode()).toBe('some');
    expect([...c.soldAtSelected()]).toEqual(['b-bgc']);
    expect((el.querySelector('[data-testid="sold-at-check-BGC"]') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('[data-testid="sold-at-check-MAK"]') as HTMLInputElement).checked).toBe(false);
    expect(el.querySelector('[data-testid="sold-at-summary"]')?.textContent).toContain('Only BGC');
  });

  it('hides the card when the shop has one branch', () => {
    const { c, products, el } = setup({ multi: false });

    expect(products.getProductSoldAt).not.toHaveBeenCalled();
    expect(c.soldAtRows()).toEqual([]);
    expect(el.querySelector('[data-testid="sold-at-card"]')).toBeNull();
  });

  it('saves the new choice after the product is updated', () => {
    const { c, products, alerts } = setup();

    c.setSoldAtMode('some');
    c.toggleSoldAtBranch('b-main');
    c.toggleSoldAtBranch('b-bgc');
    c.saveProduct();

    expect(products.updateProduct).toHaveBeenCalled();
    expect(products.saveProductSoldAt).toHaveBeenCalledWith('p1', { isAllBranches: false, branchIds: ['b-main', 'b-bgc'] });
    expect(alerts.successUpdated).toHaveBeenCalledWith('Product');
  });

  it('does not call the API when nothing changed', () => {
    const { c, products } = setup();

    c.saveProduct();

    expect(products.updateProduct).toHaveBeenCalled();
    expect(products.saveProductSoldAt).not.toHaveBeenCalled();
  });

  it('refuses to save "only the branches I pick" with no branch ticked', () => {
    const { fixture, c, products, el } = setup();

    c.setSoldAtMode('some');
    fixture.detectChanges();
    c.saveProduct();

    expect(c.soldAtEmpty()).toBe(true);
    expect(el.querySelector('[data-testid="sold-at-empty"]')).not.toBeNull();
    expect(products.updateProduct).not.toHaveBeenCalled();
  });

  it('sends the branches with a new product, and nothing when it is sold everywhere', () => {
    const everywhere = setup({ id: null });
    everywhere.c.productForm.patchValue({ name: 'Mocha', code: 'MOC1', price: 120, category: ProductCategoryEnum.Drink });
    everywhere.c.saveProduct();
    expect((everywhere.products.createProduct.mock.calls[0][0] as any).soldAtBranchIds).toBeNull();
    everywhere.fixture.destroy();
    TestBed.resetTestingModule();

    const limited = setup({ id: null });
    limited.c.productForm.patchValue({ name: 'Ube Bun', code: 'UBE1', price: 75, category: ProductCategoryEnum.Drink });
    limited.c.setSoldAtMode('some');
    limited.c.toggleSoldAtBranch('b-bgc');
    limited.c.saveProduct();
    expect((limited.products.createProduct.mock.calls[0][0] as any).soldAtBranchIds).toEqual(['b-bgc']);
    expect(limited.products.saveProductSoldAt).not.toHaveBeenCalled();
  });

  it('starts a new product for someone limited to their branches on their own branch, without the every-branch choice', () => {
    const { fixture, c, el } = setup({ id: null, canSeeAll: false, mine: ['b-bgc'] });
    fixture.detectChanges();

    expect(c.canSellEverywhere()).toBe(false);
    expect(c.soldAtMode()).toBe('some');
    expect([...c.soldAtSelected()]).toEqual(['b-bgc']);
    expect(el.querySelector('[data-testid="sold-at-all"]')).toBeNull();
  });

  it('locks the card for a product the person may not change', () => {
    const { fixture, c, el, products } = setup({
      canSeeAll: false,
      mine: ['b-bgc'],
      soldAt: soldAtFor({ all: true, canChange: false, canSellEverywhere: false }),
    });
    fixture.detectChanges();

    expect(c.soldAtLocked()).toBe(true);
    expect(el.querySelector('[data-testid="sold-at-locked"]')).not.toBeNull();
    c.saveProduct();
    expect(products.saveProductSoldAt).not.toHaveBeenCalled();
  });

  it('reports a failed save without losing the saved product', () => {
    const { c, alerts } = setup({ saveFails: true });

    c.setSoldAtMode('some');
    c.toggleSoldAtBranch('b-main');
    c.saveProduct();

    expect(alerts.error).toHaveBeenCalledWith('The product was saved, but where it is sold was not: No luck.');
    expect(alerts.successUpdated).toHaveBeenCalledWith('Product');
  });

  it('asks before leaving with an unsaved change', () => {
    const { c } = setup();

    expect(c.canDeactivate()).toBe(true);
    c.setSoldAtMode('some');
    expect(c.canDeactivate()).toBeInstanceOf(Promise);
    expect(c.showDiscardModal()).toBe(true);
  });
});
