import { ProductCategoryEnum } from '@app/testing/catalog-ids';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CatalogLookupService } from '@core/services';
import { SEEDED_LOOKUPS } from '@app/testing/catalog-ids';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { AlertService, AuthService, BranchService, ModalStackService, ProductService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { PagedResultDto, ProductDto } from '@shared/models';
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

const paged = (
  items: ProductDto[],
  page = 1,
  totalCount = items.length,
  facets?: Record<string, number>,
): PagedResultDto<ProductDto> => ({ items, page, pageSize: 25, totalCount, facets });

const branchState = {
  isMultiBranch: signal(false),
  canSeeAll: signal(true),
  branches: signal<{ id: string; name: string; code: string; isActive: boolean; isMain: boolean }[]>([]),
};

describe('ProductListComponent', () => {
  let fixture: ComponentFixture<ProductListComponent>;
  let c: any;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let alerts: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(canWrite = true, bare = false): void {
    service = {
      getProductsPaged: vi.fn(() =>
        of(
          paged(DATA.filter((p) => p.isActive).sort((a, b) => a.name.localeCompare(b.name)), 1, 4, {
            active: 4,
            inactive: 1,
            'category:1': 2,
            'category:2': 1,
            'category:3': 1,
            'category:4': 1,
          }),
        ),
      ),
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
        {
          provide: AuthService,
          useValue: {
            canWriteProducts: vi.fn(() => canWrite),
            canAddProducts: vi.fn(() => canWrite),
            canWriteBranchProducts: vi.fn(() => false),
          },
        },
        { provide: BranchService, useValue: branchState },
      ],
    });
    if (bare) {
      TestBed.overrideComponent(ProductListComponent, {
        set: { template: '', templateUrl: undefined, imports: [] },
      });
    }
    router = TestBed.inject(Router);
    TestBed.inject(CatalogLookupService).set(SEEDED_LOOKUPS);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
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

  const names = (): string[] => c.products().map((p: ProductDto) => p.name);
  const lastQuery = () => service['getProductsPaged'].mock.lastCall![0];

  it('loads the first page of active products sorted by name', () => {
    setup();
    fixture.detectChanges();
    expect(service['getProductsPaged']).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 25,
        isActive: true,
        categories: [],
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    );
    expect(names()).toEqual(['Americano', 'Bagel', 'Cake', 'Latte']);
    expect(c.isLoading()).toBe(false);
  });

  it('renders the component with data and the pagination bar', () => {
    setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Latte');
    expect(fixture.nativeElement.textContent).toContain('1 – 4 of 4');
  });

  it('is loading while the request is pending', () => {
    setup();
    const subject = new Subject<PagedResultDto<ProductDto>>();
    service['getProductsPaged'].mockReturnValue(subject);
    fixture.detectChanges();
    expect(c.isLoading()).toBe(true);
    subject.next(paged(DATA));
    expect(c.isLoading()).toBe(false);
  });

  it('alerts and stops loading on load error', () => {
    setup();
    service['getProductsPaged'].mockReturnValue(throwError(() => new Error('boom')));
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
    expect(service['getProductsPaged']).toHaveBeenCalledTimes(2);
    expect(c.isRefreshing()).toBe(false);
  });

  it('reads category and status counts from the server counts', () => {
    setup();
    fixture.detectChanges();
    expect(c.categoryCounts()).toEqual({ 1: 2, 2: 1, 3: 1, 4: 1 });
    expect(c.statusCounts()).toEqual({ active: 4, inactive: 1 });
    expect(c.typeOptions().map((o: any) => o.count)).toEqual([2, 1, 1, 1]);
    expect(c.statusOptions().map((o: any) => o.count)).toEqual([4, 1]);
  });

  describe('paging', () => {
    beforeEach(() => {
      setup();
      service['getProductsPaged'].mockImplementation((q: { page: number }) => of(paged(DATA, q.page, 120)));
      fixture.detectChanges();
    });

    it('goes to a page and writes it to the address', () => {
      c.goToPage(3);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 3 }));
      expect(vi.mocked(router.navigate).mock.lastCall![1]!.queryParams).toEqual({ page: 3 });
    });

    it('a new page size, type, status or sort returns to page one', () => {
      c.goToPage(3);
      c.changePageSize(50);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, pageSize: 50 }));
      c.goToPage(3);
      c.toggleTypeSelection(ProductCategoryEnum.Food);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, categories: [ProductCategoryEnum.Food] }));
      c.goToPage(3);
      c.toggleSort('price');
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, sortBy: 'price' }));
    });
  });

  describe('filtering', () => {
    beforeEach(() => {
      setup(true, true);
      fixture.detectChanges();
    });

    it('searches on the server after the debounce and persists it', async () => {
      service['getProductsPaged'].mockClear();
      c.filterForm.controls.searchTerm.setValue('CA');
      expect(service['getProductsPaged']).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(lastQuery()).toEqual(expect.objectContaining({ searchTerm: 'CA', page: 1 }));
      expect(JSON.parse(localStorage.getItem(STATE_KEY) as string).searchTerm).toBe('CA');
    });

    it('filters by type on the server', () => {
      c.onTypeFilterChange([ProductCategoryEnum.Drink]);
      expect(lastQuery().categories).toEqual([ProductCategoryEnum.Drink]);
      expect(c.isTypeSelected(ProductCategoryEnum.Drink)).toBe(true);
      c.onTypeFilterReset();
      expect(lastQuery().categories).toEqual([]);
    });

    it('toggles type selection on and off', () => {
      c.toggleTypeSelection(ProductCategoryEnum.Food);
      c.toggleTypeSelection(ProductCategoryEnum.Dessert);
      expect(lastQuery().categories).toEqual([ProductCategoryEnum.Food, ProductCategoryEnum.Dessert]);
      c.toggleTypeSelection(ProductCategoryEnum.Food);
      expect(lastQuery().categories).toEqual([ProductCategoryEnum.Dessert]);
      c.clearTypeSelections();
      expect(c.selectedTypes()).toEqual([]);
    });

    it('asks for inactive, both or active products', () => {
      c.toggleStatusSelection('active');
      c.toggleStatusSelection('inactive');
      expect(lastQuery().isActive).toBe(false);
      c.toggleStatusSelection('active');
      expect(lastQuery().isActive).toBeUndefined();
      c.onStatusFilterChange(['active']);
      expect(lastQuery().isActive).toBe(true);
      expect(c.isStatusSelected('active')).toBe(true);
    });

    it('empty status selection asks for everything', () => {
      c.onStatusFilterReset();
      expect(lastQuery().isActive).toBeUndefined();
      c.onStatusFilterChange(['inactive']);
      c.clearStatusSelections();
      expect(lastQuery().isActive).toBeUndefined();
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

    it('toggles direction on the same column, on the server', () => {
      c.toggleSort('name');
      expect(c.sortDirection()).toBe('desc');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'name', sortDirection: 'desc' }));
      c.toggleSort('name');
      expect(c.sortDirection()).toBe('asc');
    });

    it('switches to a new column ascending', () => {
      c.toggleSort('price');
      expect(c.sortColumn()).toBe('price');
      expect(c.sortDirection()).toBe('asc');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'price', sortDirection: 'asc' }));
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
        soldAt: '',
        sortColumn: 'price',
        sortDirection: 'asc',
        pageSize: 25,
      });
    });

    it('restores saved state on init, including the rows per page', () => {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          searchTerm: 'mug',
          selectedTypes: [4],
          selectedStatuses: ['inactive'],
          sortColumn: 'price',
          sortDirection: 'desc',
          pageSize: 50,
        }),
      );
      setup();
      fixture.detectChanges();
      expect(c.filterForm.controls.searchTerm.value).toBe('mug');
      expect(c.sortColumn()).toBe('price');
      expect(c.sortDirection()).toBe('desc');
      expect(lastQuery()).toEqual(
        expect.objectContaining({ searchTerm: 'mug', categories: [4], isActive: false, pageSize: 50 }),
      );
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
      expect(service['getProductsPaged']).toHaveBeenCalledTimes(2);
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
      expect(service['getProductsPaged']).toHaveBeenCalledTimes(2);
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
  describe('sold at', () => {
    const twoBranches = [
      { id: 'b-main', name: 'Makati', code: 'MAK', isActive: true, isMain: true },
      { id: 'b-bgc', name: 'BGC', code: 'BGC', isActive: true, isMain: false },
    ];

    afterEach(() => {
      branchState.isMultiBranch.set(false);
      branchState.branches.set([]);
    });

    it('shows no filter or chip for a shop with one branch', () => {
      setup(true);
      fixture.detectChanges();

      expect(c.showSoldAtFilter()).toBe(false);
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="sold-at-filter"]')).toBeNull();
    });

    it('lists each branch and the limited products with their counts, and asks the server for one', () => {
      branchState.isMultiBranch.set(true);
      branchState.branches.set(twoBranches);
      setup(true);
      service['getProductsPaged'].mockReturnValue(
        of({ items: [], totalCount: 0, page: 1, pageSize: 25, totalPages: 1, facets: { active: 4, inactive: 1, 'soldat:b-main': 3, 'soldat:b-bgc': 4, 'soldat:limited': 2 } }),
      );
      fixture.detectChanges();

      expect(c.soldAtOptions().map((o: any) => [o.id, o.count])).toEqual([
        ['b-main', 3],
        ['b-bgc', 4],
        ['limited', 2],
      ]);

      c.selectSoldAt('b-bgc');
      expect(lastQuery()).toEqual(expect.objectContaining({ soldAtBranchId: 'b-bgc', limitedOnly: false, page: 1 }));
      expect(c.activeFilterCount()).toBe(2);

      c.selectSoldAt('limited');
      expect(lastQuery()).toEqual(expect.objectContaining({ soldAtBranchId: null, limitedOnly: true }));

      c.clearSoldAt();
      expect(lastQuery()).toEqual(expect.objectContaining({ soldAtBranchId: null, limitedOnly: false }));
      expect(JSON.parse(localStorage.getItem(STATE_KEY) as string).soldAt).toBe('');
    });

    it('labels a limited product with its branch', () => {
      branchState.isMultiBranch.set(true);
      branchState.branches.set(twoBranches);
      setup(true);

      expect(c.soldAtLabel({ soldAtBranchIds: null })).toBeNull();
      expect(c.soldAtLabel({ soldAtBranchIds: ['b-bgc'] })).toBe('Only BGC');
      expect(c.soldAtLabel({ soldAtBranchIds: ['b-bgc', 'b-main'] })).toBe('2 branches');
    });

    it('keeps the chosen branch when the page is opened again', () => {
      branchState.isMultiBranch.set(true);
      branchState.branches.set(twoBranches);
      localStorage.setItem(STATE_KEY, JSON.stringify({ searchTerm: '', selectedTypes: [], selectedStatuses: ['active'], soldAt: 'b-bgc', sortColumn: 'name', sortDirection: 'asc' }));
      setup(true);
      fixture.detectChanges();

      expect(lastQuery()).toEqual(expect.objectContaining({ soldAtBranchId: 'b-bgc' }));
    });
  });

  describe('filter count on the Filters button', () => {
    it('adds the chosen types to the chosen statuses', () => {
      setup(true);
      expect(c.activeFilterCount()).toBe(1);
      c.selectedTypes.set([c.typeOptions()[0].id]);
      expect(c.activeFilterCount()).toBe(2);
      c.selectedStatuses.set([]);
      expect(c.activeFilterCount()).toBe(1);
    });
  });
});
