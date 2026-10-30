/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AlertService, AuthService, InventoryService, ProductService } from '@core/services';
import { ProductCategoryEnum, ProductDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductEditorComponent } from './product-editor';

const created = { id: 'new', name: 'Oat Milk Box', code: 'OMB', price: 850 } as ProductDto;

describe('ProductEditorComponent: track inventory', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(canWriteItems = true) {
    const products = {
      createProduct: vi.fn(() => of(created)),
      getProducts: vi.fn(() => of([])),
    };
    const inventory = {
      getInventoryItems: vi.fn(() =>
        of([
          { id: 'milk', name: '1L Oat Milk', unitName: 'milliliter', currentQuantity: 9800, allowNegativeStock: true },
          { id: 'cup', name: 'Large Cup', unitName: 'piece', currentQuantity: 1, allowNegativeStock: false },
        ]),
      ),
      createInventoryItem: vi.fn(() => of({ id: 'own-item' })),
      linkProductToItem: vi.fn(() => of({})),
    };
    const alerts = { error: vi.fn(), successCreated: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: products },
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canWriteItems: () => canWriteItems, canReadInventoryCosts: () => true } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
      ],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductEditorComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as any;
    c.productForm.patchValue({
      name: 'Oat Milk Box',
      code: 'OMB',
      price: 850,
      category: ProductCategoryEnum.Other,
    });
    return { fixture, c, products, inventory, alerts, navigate };
  }

  it('shows the card to roles that manage items, and not to others', () => {
    const allowed = setup(true);
    expect(allowed.fixture.nativeElement.querySelector('[data-testid="track-inventory"]')).not.toBeNull();
    TestBed.resetTestingModule();

    const denied = setup(false);
    expect(denied.fixture.nativeElement.querySelector('[data-testid="track-inventory"]')).toBeNull();
    expect(denied.inventory.getInventoryItems).not.toHaveBeenCalled();
  });

  it('does nothing about stock by default', () => {
    const { c, inventory, products } = setup();
    c.saveProduct();

    expect(products.createProduct).toHaveBeenCalled();
    expect(inventory.createInventoryItem).not.toHaveBeenCalled();
    expect(inventory.linkProductToItem).not.toHaveBeenCalled();
  });

  it('creates an item for the product and links it with a quantity of 1', () => {
    const { c, inventory } = setup();
    c.setStockMode('own');
    c.stockForm.patchValue({
      startingQuantity: 12,
      costPrice: 40,
      warningQuantity: 5,
      criticalQuantity: 2,
    });
    c.saveProduct();

    expect(inventory.createInventoryItem).toHaveBeenCalledWith({
      name: 'Oat Milk Box',
      unitName: 'piece',
      startingQuantity: 12,
      costPrice: 40,
      warningQuantity: 5,
      criticalQuantity: 2,
      isActive: true,
    });
    expect(inventory.linkProductToItem).toHaveBeenCalledWith('new', 'own-item', 1);
  });

  it('links the product to an existing item with the deduct quantity', () => {
    const { c, inventory } = setup();
    c.setStockMode('existing');
    c.stockForm.patchValue({ existingItemId: 'milk', quantityPerSale: 6 });
    c.saveProduct();

    expect(inventory.createInventoryItem).not.toHaveBeenCalled();
    expect(inventory.linkProductToItem).toHaveBeenCalledWith('new', 'milk', 6);
  });

  it('still finishes the save and says so when the stock setup fails', () => {
    const { c, inventory, alerts, navigate } = setup();
    inventory.linkProductToItem.mockReturnValue(throwError(() => new Error('Item not found.')));
    c.setStockMode('existing');
    c.stockForm.patchValue({ existingItemId: 'milk', quantityPerSale: 6 });
    c.saveProduct();

    expect(alerts.error).toHaveBeenCalledWith(expect.stringContaining('stock setup failed: Item not found.'));
    expect(alerts.successCreated).toHaveBeenCalledWith('Product');
    expect(navigate).toHaveBeenCalled();
  });

  describe('stock impact preview', () => {
    const preview = (fixture: { detectChanges: () => void; nativeElement: HTMLElement }) => {
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('[data-testid="stock-impact"]')?.textContent?.trim() ?? null;
    };

    it('shows nothing while no stock tracking is chosen', () => {
      const { fixture } = setup();
      expect(preview(fixture)).toBeNull();
    });

    it('shows how many sales the starting stock covers for an own item', () => {
      const { fixture, c } = setup();
      c.setStockMode('own');
      c.stockForm.patchValue({ startingQuantity: 12 });
      expect(preview(fixture)).toBe('Each sale takes 1 piece. The starting stock covers 12 sales.');
    });

    it('shows what one sale takes from an existing item and how many sales are covered', () => {
      const { fixture, c } = setup();
      c.setStockMode('existing');
      c.stockForm.patchValue({ existingItemId: 'milk', quantityPerSale: 6000 });
      expect(preview(fixture)).toBe(
        'Each sale takes 6000 ml. 1L Oat Milk has 9800 ml in stock, enough for 1 sale.',
      );
    });

    it('warns that a short item will go below zero and warn', () => {
      const { fixture, c } = setup();
      c.setStockMode('existing');
      c.stockForm.patchValue({ existingItemId: 'milk', quantityPerSale: 20000 });
      expect(preview(fixture)).toContain('it will go below zero and warn');
    });

    it('warns that a blocking item will refuse online sales until stock is added', () => {
      const { fixture, c } = setup();
      c.setStockMode('existing');
      c.stockForm.patchValue({ existingItemId: 'cup', quantityPerSale: 2 });
      expect(preview(fixture)).toContain('online sales of this product will be refused');
    });

    it('shows nothing until an item is chosen', () => {
      const { fixture, c } = setup();
      c.setStockMode('existing');
      expect(preview(fixture)).toBeNull();
    });
  });
});
