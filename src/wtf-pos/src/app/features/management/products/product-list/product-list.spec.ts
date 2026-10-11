/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AlertService, AuthService, ModalStackService, ProductService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { ProductCategoryEnum, ProductDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductListComponent } from './product-list';

const STATE_KEY = 'management:product-list';

function product(over: Partial<ProductDto>): ProductDto {
  return {
    id: 'p1',
    name: 'Latte',
    code: 'LAT',
    price: 100,
    category: ProductCategoryEnum.Drink,
    isAddOn: false,
    isActive: true,
    createdAt: '2024-01-01',
    createdBy: 'u',
    priceHistory: [],
    addOnCount: 0,
    ...over,
  };
}

const DATA: ProductDto[] = [
  product({ id: '1', name: 'Latte', price: 120, category: ProductCategoryEnum.Drink }),
  product({ id: '2', name: 'Bagel', price: 80, category: ProductCategoryEnum.Food }),
  product({ id: '3', name: 'Cake', price: 150, category: ProductCategoryEnum.Dessert }),
  product({ id: '4', name: 'Mug', price: 300, category: ProductCategoryEnum.Other, isActive: false }),
  product({ id: '5', name: 'Americano', price: 90, category: ProductCategoryEnum.Drink }),
];

describe('ProductListComponent', () => {
  let fixture: ComponentFixture<ProductListComponent>;
  let c: any;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let alerts: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(canWrite = true, bare = false): void {
    service = {
      getProducts: vi.fn(() => of(DATA)),
      deleteProduct: vi.fn(() => of(undefined)),
      restoreProduct: vi.fn(() => of(undefined)),
    };
    alerts = {
      error: vi.fn(),
      errorUnauthorized: vi.fn(),
      successRestored: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canWriteProducts: vi.fn(() => canWrite) } },
      ],
    });
    if (bare) {
      TestBed.overrideComponent(ProductListComponent, {
        set: { template: '', templateUrl: undefined, imports: [] },
      });
    }
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(ProductListComponent);
    c = fixture.componentInstance;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  const names = (): string[] => c.sortedProducts().map((p: ProductDto) => p.name);

  it('loads products on init and shows only active ones by default, sorted by name', () => {
    setup();
    fixture.detectChanges();
    expect(service['getProducts']).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(['Americano', 'Bagel', 'Cake', 'Latte']);
    expect(c.isLoading()).toBe(false);
  });

  it('renders the component with data', () => {
    setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Latte');
  });

  it('is loading while the request is pending', () => {
    setup();
    const subject = new Subject<ProductDto[]>();
    service['getProducts'].mockReturnValue(subject);
    fixture.detectChanges();
    expect(c.isLoading()).toBe(true);
    subject.next(DATA);
    expect(c.isLoading()).toBe(false);
  });

  it('alerts and stops loading on load error', () => {
    setup();
    service['getProducts'].mockReturnValue(throwError(() => new Error('boom')));
    c.isRefreshing.set(true);
    fixture.detectChanges();
    expect(alerts['error']).toHaveBeenCalledWith('boom');
    expect(c.isLoading()).toBe(false);
    expect(c.isRefreshing()).toBe(false);
  });

  it('refresh reloads and clears the refreshing flag', () => {
    setup();
    fixture.detectChanges();
    c.refresh();
    expect(service['getProducts']).toHaveBeenCalledTimes(2);
    expect(c.isRefreshing()).toBe(false);
  });

  it('computes category and status counts from the cache', () => {
    setup();
    fixture.detectChanges();
    expect(c.categoryCounts()).toEqual({ 1: 2, 2: 1, 3: 1, 4: 1 });
    expect(c.statusCounts()).toEqual({ active: 4, inactive: 1 });
    expect(c.typeOptions().map((o: any) => o.count)).toEqual([2, 1, 1, 1]);
    expect(c.statusOptions().map((o: any) => o.count)).toEqual([4, 1]);
  });

  describe('filtering', () => {
    beforeEach(() => {
      setup(true, true);
      fixture.detectChanges();
    });

    it('filters by search term after the debounce, case-insensitively, and persists it', async () => {
      c.filterForm.controls.searchTerm.setValue('CA');
      expect(names()).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(300);
      expect(names()).toEqual(['Americano', 'Cake']);
      expect(JSON.parse(localStorage.getItem(STATE_KEY) as string).searchTerm).toBe('CA');
    });

    it('ignores whitespace-only search', async () => {
      c.filterForm.controls.searchTerm.setValue('   ');
      await vi.advanceTimersByTimeAsync(300);
      expect(names()).toHaveLength(4);
    });

    it('filters by type', () => {
      c.onTypeFilterChange([ProductCategoryEnum.Drink]);
      expect(names()).toEqual(['Americano', 'Latte']);
      expect(c.isTypeSelected(ProductCategoryEnum.Drink)).toBe(true);
      c.onTypeFilterReset();
      expect(names()).toHaveLength(4);
    });

    it('toggles type selection on and off', () => {
      c.toggleTypeSelection(ProductCategoryEnum.Food);
      expect(names()).toEqual(['Bagel']);
      c.toggleTypeSelection(ProductCategoryEnum.Dessert);
      expect(names()).toEqual(['Bagel', 'Cake']);
      c.toggleTypeSelection(ProductCategoryEnum.Food);
      expect(names()).toEqual(['Cake']);
      c.clearTypeSelections();
      expect(c.selectedTypes()).toEqual([]);
    });

    it('filters by status including inactive and both', () => {
      c.toggleStatusSelection('active');
      c.toggleStatusSelection('inactive');
      expect(names()).toEqual(['Mug']);
      c.toggleStatusSelection('active');
      expect(names()).toHaveLength(5);
      c.onStatusFilterChange(['active']);
      expect(names()).toHaveLength(4);
      expect(c.isStatusSelected('active')).toBe(true);
    });

    it('empty status selection shows everything', () => {
      c.onStatusFilterReset();
      expect(names()).toHaveLength(5);
      c.onStatusFilterChange(['inactive']);
      c.clearStatusSelections();
      expect(names()).toHaveLength(5);
    });

    it('opens and closes the filter drawer', () => {
      c.openFilters();
      expect(c.isFiltersOpen()).toBe(true);
      c.closeFilters();
      expect(c.isFiltersOpen()).toBe(false);
    });
  });

  describe('sorting', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('toggles direction on the same column', () => {
      c.toggleSort('name');
      expect(c.sortDirection()).toBe('desc');
      expect(names()[0]).toBe('Latte');
      c.toggleSort('name');
      expect(c.sortDirection()).toBe('asc');
    });

    it('switches to a new column ascending and sorts by price', () => {
      c.toggleSort('price');
      expect(c.sortColumn()).toBe('price');
      expect(c.sortDirection()).toBe('asc');
      expect(names()).toEqual(['Bagel', 'Americano', 'Latte', 'Cake']);
      c.toggleSort('price');
      expect(names()).toEqual(['Cake', 'Latte', 'Americano', 'Bagel']);
    });

    it('does not sort when column is null', () => {
      c.sortColumn.set(null);
      expect(names()).toEqual(['Latte', 'Bagel', 'Cake', 'Americano']);
    });
  });

  describe('state persistence', () => {
    it('saves state on filter and sort changes', () => {
      setup();
      fixture.detectChanges();
      c.toggleTypeSelection(2);
      c.toggleSort('price');
      expect(JSON.parse(localStorage.getItem(STATE_KEY) as string)).toEqual({
        searchTerm: '',
        selectedTypes: [2],
        selectedStatuses: ['active'],
        sortColumn: 'price',
        sortDirection: 'asc',
      });
    });

    it('restores saved state on init', () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          searchTerm: 'mug',
          selectedTypes: [4],
          selectedStatuses: ['inactive'],
          sortColumn: 'price',
          sortDirection: 'desc',
        }),
      );
      setup();
      fixture.detectChanges();
      expect(c.filterForm.controls.searchTerm.value).toBe('mug');
      expect(c.sortColumn()).toBe('price');
      expect(c.sortDirection()).toBe('desc');
      expect(names()).toEqual(['Mug']);
    });
  });

  describe('navigation and permissions', () => {
    it('navigates to new / edit / details', () => {
      setup();
      fixture.detectChanges();
      c.navigateToEditor();
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementProductsNew);
      c.navigateToEditor('x');
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementProductEditById('x'));
      c.navigateToDetails('x');
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        AppRoutes.ManagementProductDetailsById('x'),
      );
    });

    it('blocks write actions without permission', () => {
      setup(false);
      fixture.detectChanges();
      c.navigateToEditor('x');
      c.deleteProduct(DATA[0]);
      c.restoreProduct(DATA[3]);
      c.productToDelete.set(DATA[0]);
      c.confirmDelete();
      c.productToRestore.set(DATA[3]);
      c.confirmRestore();
      expect(alerts['errorUnauthorized']).toHaveBeenCalledTimes(5);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(c.showDeleteModal()).toBe(false);
      expect(service['deleteProduct']).not.toHaveBeenCalled();
      expect(service['restoreProduct']).not.toHaveBeenCalled();
    });
  });

  describe('delete flow', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('opens the modal and registers it on the modal stack', () => {
      const stack = TestBed.inject(ModalStackService);
      c.deleteProduct(DATA[0]);
      expect(c.showDeleteModal()).toBe(true);
      expect(c.productToDelete()).toBe(DATA[0]);
      expect(stack.hasOpen()).toBe(true);
      stack.pop();
      expect(c.showDeleteModal()).toBe(false);
      expect(stack.hasOpen()).toBe(false);
    });

    it('cancel closes the modal', () => {
      c.deleteProduct(DATA[0]);
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(c.productToDelete()).toBeNull();
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('cancel is ignored while deleting', () => {
      c.deleteProduct(DATA[0]);
      c.isDeleting.set(true);
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(true);
    });

    it('confirm deletes, closes and reloads', () => {
      c.deleteProduct(DATA[0]);
      c.confirmDelete();
      expect(service['deleteProduct']).toHaveBeenCalledWith('1');
      expect(c.showDeleteModal()).toBe(false);
      expect(c.isDeleting()).toBe(false);
      expect(service['getProducts']).toHaveBeenCalledTimes(2);
    });

    it('confirm without a target does nothing', () => {
      c.confirmDelete();
      expect(service['deleteProduct']).not.toHaveBeenCalled();
    });

    it('confirm ignores re-entry while deleting', () => {
      c.deleteProduct(DATA[0]);
      c.isDeleting.set(true);
      c.confirmDelete();
      expect(service['deleteProduct']).not.toHaveBeenCalled();
    });

    it('shows the error and keeps the modal open on failure', () => {
      service['deleteProduct'].mockReturnValue(throwError(() => new Error('nope')));
      c.deleteProduct(DATA[0]);
      c.confirmDelete();
      expect(alerts['error']).toHaveBeenCalledWith('nope');
      expect(c.isDeleting()).toBe(false);
      expect(c.showDeleteModal()).toBe(true);
    });
  });

  describe('restore flow', () => {
    beforeEach(() => {
      setup();
      fixture.detectChanges();
    });

    it('opens, cancels and confirms', () => {
      c.restoreProduct(DATA[3]);
      expect(c.showRestoreModal()).toBe(true);
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(false);

      c.restoreProduct(DATA[3]);
      c.confirmRestore();
      expect(service['restoreProduct']).toHaveBeenCalledWith('4');
      expect(alerts['successRestored']).toHaveBeenCalledWith('Product');
      expect(c.showRestoreModal()).toBe(false);
      expect(service['getProducts']).toHaveBeenCalledTimes(2);
    });

    it('cancel is ignored while restoring, and confirm without target is a no-op', () => {
      c.confirmRestore();
      expect(service['restoreProduct']).not.toHaveBeenCalled();
      c.restoreProduct(DATA[3]);
      c.isRestoring.set(true);
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(true);
      c.confirmRestore();
      expect(service['restoreProduct']).not.toHaveBeenCalled();
    });

    it('reports restore errors', () => {
      service['restoreProduct'].mockReturnValue(throwError(() => new Error('fail')));
      c.restoreProduct(DATA[3]);
      c.confirmRestore();
      expect(alerts['error']).toHaveBeenCalledWith('fail');
      expect(c.isRestoring()).toBe(false);
      expect(c.showRestoreModal()).toBe(true);
    });
  });

  describe('labels', () => {
    beforeEach(() => {
      setup();
    });

    it('returns the category name', () => {
      expect(c.getProductCategoryName(ProductCategoryEnum.Dessert)).toBe('Dessert');
    });

    it('pluralises association labels for add-ons and products', () => {
      expect(c.getAssociationLabel(product({ isAddOn: true, addOnCount: 1 }))).toBe('1 linked item');
      expect(c.getAssociationLabel(product({ isAddOn: true, addOnCount: 3 }))).toBe(
        '3 linked items',
      );
      expect(c.getAssociationLabel(product({ addOnCount: 1 }))).toBe('1 associated add-on');
      expect(c.getAssociationLabel(product({ addOnCount: 0 }))).toBe('0 associated add-ons');
    });
  });

  it('exposes permission from the auth service', () => {
    setup(true);
    expect(c.canWriteProducts()).toBe(true);
  });
});
