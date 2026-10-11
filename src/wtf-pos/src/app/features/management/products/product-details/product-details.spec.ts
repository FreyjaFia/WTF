/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AlertService, AuthService, ModalStackService, ProductService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  AddOnGroupDto,
  AddOnTypeEnum,
  ProductCategoryEnum,
  ProductDto,
  ProductSubCategoryEnum,
} from '@shared/models';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailsComponent } from './product-details';

function product(over: Partial<ProductDto> = {}): ProductDto {
  return {
    id: 'p1',
    name: 'Latte',
    code: 'LAT',
    price: 100,
    category: ProductCategoryEnum.Drink,
    isAddOn: false,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    createdBy: 'u',
    priceHistory: [],
    addOnCount: 0,
    ...over,
  };
}

function group(type: AddOnTypeEnum, names: string[]): AddOnGroupDto {
  return {
    type,
    displayName: AddOnTypeEnum[type],
    options: names.map((n, i) => product({ id: `${type}-${i}`, name: n, isAddOn: true })),
  };
}

describe('ProductDetailsComponent', () => {
  let fixture: ComponentFixture<ProductDetailsComponent>;
  let c: any;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let alerts: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(opts: { id?: string | null; canWrite?: boolean } = {}): void {
    const id = opts.id === undefined ? 'p1' : opts.id;
    service = {
      getProduct: vi.fn(() => of(product({ priceHistory: [{ price: 1 } as any] }))),
      getLinkedProducts: vi.fn(() => of([group(AddOnTypeEnum.Size, ['Z'])])),
      getProductAddOns: vi.fn(() => of([group(AddOnTypeEnum.Size, ['Small'])])),
      deleteProduct: vi.fn(() => of(undefined)),
      restoreProduct: vi.fn(() => of(undefined)),
    };
    alerts = {
      error: vi.fn(),
      errorUnauthorized: vi.fn(),
      successDeleted: vi.fn(),
      successRestored: vi.fn(),
      getDeleteErrorMessage: vi.fn(() => 'default delete error'),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canWriteProducts: () => opts.canWrite ?? true } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => id } } },
        },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fixture = TestBed.createComponent(ProductDetailsComponent);
    c = fixture.componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads a regular product with its add-ons', () => {
    setup();
    fixture.detectChanges();
    expect(service['getProduct']).toHaveBeenCalledWith('p1');
    expect(service['getProductAddOns']).toHaveBeenCalledWith('p1');
    expect(service['getLinkedProducts']).not.toHaveBeenCalled();
    expect(c.addOns()).toHaveLength(1);
    expect(c.priceHistory()).toHaveLength(1);
    expect(c.isLoading()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Latte');
  });

  it('loads linked products for an add-on product', () => {
    setup();
    service['getProduct'].mockReturnValue(of(product({ isAddOn: true })));
    fixture.detectChanges();
    expect(service['getLinkedProducts']).toHaveBeenCalledWith('p1');
    expect(service['getProductAddOns']).not.toHaveBeenCalled();
    expect(c.totalLinkedCount()).toBe(1);
  });

  it('does nothing without an id route param', () => {
    setup({ id: null });
    fixture.detectChanges();
    expect(service['getProduct']).not.toHaveBeenCalled();
  });

  it('alerts when product load fails', () => {
    setup();
    service['getProduct'].mockReturnValue(throwError(() => new Error('missing')));
    fixture.detectChanges();
    expect(alerts['error']).toHaveBeenCalledWith('missing');
    expect(c.isLoading()).toBe(false);
  });

  it('stops loading silently when add-ons fail to load', () => {
    setup();
    service['getProductAddOns'].mockReturnValue(throwError(() => new Error('x')));
    fixture.detectChanges();
    expect(c.isLoading()).toBe(false);
    expect(alerts['error']).not.toHaveBeenCalled();
  });

  it('stops loading silently when linked products fail to load', () => {
    setup();
    service['getProduct'].mockReturnValue(of(product({ isAddOn: true })));
    service['getLinkedProducts'].mockReturnValue(throwError(() => new Error('x')));
    fixture.detectChanges();
    expect(c.isLoading()).toBe(false);
  });

  it('sorts add-on groups by type order and options by name, and totals counts', () => {
    setup();
    service['getProductAddOns'].mockReturnValue(
      of([
        group(AddOnTypeEnum.Extra, ['b', 'a']),
        group(AddOnTypeEnum.Size, ['Large', 'Small']),
        group(AddOnTypeEnum.Sauce, ['Mayo']),
      ]),
    );
    fixture.detectChanges();
    expect(c.sortedAddOns().map((g: AddOnGroupDto) => g.type)).toEqual([
      AddOnTypeEnum.Size,
      AddOnTypeEnum.Sauce,
      AddOnTypeEnum.Extra,
    ]);
    expect(c.sortedAddOns()[2].options.map((o: ProductDto) => o.name)).toEqual(['a', 'b']);
    expect(c.totalAddOnsCount()).toBe(5);
  });

  it('sorts linked products too', () => {
    setup();
    c.linkedProducts.set([group(AddOnTypeEnum.Topping, ['y', 'x']), group(AddOnTypeEnum.Size, ['s'])]);
    expect(c.sortedLinkedProducts()[0].type).toBe(AddOnTypeEnum.Size);
    expect(c.sortedLinkedProducts()[1].options[0].name).toBe('x');
    expect(c.totalLinkedCount()).toBe(3);
  });

  describe('permissions', () => {
    beforeEach(() => {
      setup({ canWrite: false });
      fixture.detectChanges();
    });

    it('rejects edit, delete, restore and their confirmations', () => {
      c.navigateToEdit();
      c.deleteProduct();
      c.restoreProduct();
      c.confirmDelete();
      c.confirmRestore();
      expect(alerts['errorUnauthorized']).toHaveBeenCalledTimes(5);
      expect(c.showDeleteModal()).toBe(false);
      expect(c.showRestoreModal()).toBe(false);
      expect(service['deleteProduct']).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('hides Edit/Delete buttons', () => {
      expect(fixture.nativeElement.textContent).not.toContain('Delete');
    });
  });

  describe('actions', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('goes back and navigates to edit', () => {
      c.goBack();
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementProducts);
      c.navigateToEdit();
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementProductEditById('p1'));
    });

    it('edit with no product loaded does nothing', () => {
      c.product.set(null);
      c.navigateToEdit();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('delete modal open/cancel via stack', () => {
      const stack = TestBed.inject(ModalStackService);
      c.deleteProduct();
      expect(c.showDeleteModal()).toBe(true);
      expect(stack.hasOpen()).toBe(true);
      stack.pop();
      expect(c.showDeleteModal()).toBe(false);
    });

    it('delete is ignored without a product, and cancel ignored while deleting', () => {
      c.product.set(null);
      c.deleteProduct();
      c.confirmDelete();
      expect(c.showDeleteModal()).toBe(false);
      c.product.set(product());
      c.deleteProduct();
      c.isDeleting.set(true);
      c.cancelDelete();
      c.confirmDelete();
      expect(c.showDeleteModal()).toBe(true);
      expect(service['deleteProduct']).not.toHaveBeenCalled();
    });

    it('confirms delete, alerts and returns to the list', () => {
      c.deleteProduct();
      c.confirmDelete();
      expect(service['deleteProduct']).toHaveBeenCalledWith('p1');
      expect(alerts['successDeleted']).toHaveBeenCalledWith('Product');
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementProducts);
      expect(c.showDeleteModal()).toBe(false);
    });

    it('shows the server error, or the default message when empty', () => {
      service['deleteProduct'].mockReturnValue(throwError(() => new Error('server says no')));
      c.deleteProduct();
      c.confirmDelete();
      expect(alerts['error']).toHaveBeenLastCalledWith('server says no');
      service['deleteProduct'].mockReturnValue(throwError(() => new Error('')));
      c.confirmDelete();
      expect(alerts['error']).toHaveBeenLastCalledWith('default delete error');
      expect(c.isDeleting()).toBe(false);
    });

    it('restore flow reloads the product on success', () => {
      c.restoreProduct();
      expect(c.showRestoreModal()).toBe(true);
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(false);
      c.restoreProduct();
      c.confirmRestore();
      expect(service['restoreProduct']).toHaveBeenCalledWith('p1');
      expect(alerts['successRestored']).toHaveBeenCalledWith('Product');
      expect(service['getProduct']).toHaveBeenCalledTimes(2);
      expect(c.showRestoreModal()).toBe(false);
    });

    it('restore errors are reported and re-entry is guarded', () => {
      service['restoreProduct'].mockReturnValue(throwError(() => new Error('r')));
      c.restoreProduct();
      c.confirmRestore();
      expect(alerts['error']).toHaveBeenCalledWith('r');
      expect(c.isRestoring()).toBe(false);
      c.isRestoring.set(true);
      c.cancelRestore();
      c.confirmRestore();
      expect(c.showRestoreModal()).toBe(true);
      expect(service['restoreProduct']).toHaveBeenCalledTimes(1);
    });

    it('restore ignored without a product', () => {
      c.product.set(null);
      c.restoreProduct();
      c.confirmRestore();
      expect(c.showRestoreModal()).toBe(false);
      expect(service['restoreProduct']).not.toHaveBeenCalled();
    });

    it('toggles drawers and show-all flags', () => {
      c.openPriceHistory();
      expect(c.isHistoryOpen()).toBe(true);
      c.closePriceHistory();
      expect(c.isHistoryOpen()).toBe(false);
      c.toggleShowAllAddOns();
      c.toggleShowAllLinked();
      expect(c.showAllAddOns()).toBe(true);
      expect(c.showAllLinked()).toBe(true);
      c.toggleShowAllAddOns();
      expect(c.showAllAddOns()).toBe(false);
    });
  });

  describe('labels', () => {
    beforeEach(() => setup());

    it('category and sub category names', () => {
      expect(c.getProductCategoryName(ProductCategoryEnum.Food)).toBe('Food');
      expect(c.getSubCategoryName(null)).toBe('None');
      expect(c.getSubCategoryName(undefined)).toBe('None');
      expect(c.getSubCategoryName(ProductSubCategoryEnum.NonCoffee)).toBe('Non-Coffee');
      expect(c.getSubCategoryName(99 as ProductSubCategoryEnum)).toBe('Unknown');
    });
  });

  it('uses ModalStackService from root (not faked)', () => {
    setup();
    expect(TestBed.inject(ModalStackService)).toBeTruthy();
  });
});
