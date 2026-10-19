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
      getInventoryItems: vi.fn(() => of([{ id: 'milk', name: '1L Oat Milk' }])),
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
        { provide: AuthService, useValue: { canWriteItems: () => canWriteItems } },
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
});
