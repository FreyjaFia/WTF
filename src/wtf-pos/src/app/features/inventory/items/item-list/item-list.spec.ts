import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  AlertService,
  AuthService,
  InventoryService,
  ListStateService,
  ModalStackService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { ItemDto, PagedResultDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internals } from '../../../../testing/feature-spec-helpers';
import { ItemListComponent } from './item-list';

function makeItem(overrides: Partial<ItemDto> = {}): ItemDto {
  return {
    id: 'i1',
    name: 'Coffee Beans',
    sku: 'CB-1',
    barcode: '123456',
    unitName: 'gram',
    stockUnitName: null,
    unitsPerStockUnit: null,
    currentQuantity: 100,
    costPrice: 5,
    warningQuantity: 50,
    criticalQuantity: 10,
    isActive: true,
    allowNegativeStock: true,
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'u',
    priceHistory: [],
    productLinks: [],
    recentMovements: [],
    ...overrides,
  };
}

const OK_ITEM = makeItem({ id: 'ok', name: 'Alpha Milk', sku: 'MLK', barcode: 'B-111', currentQuantity: 100 });
const WARN_ITEM = makeItem({ id: 'warn', name: 'Beta Sugar', sku: 'SGR', barcode: null, currentQuantity: 40 });
const CRIT_ITEM = makeItem({ id: 'crit', name: 'Gamma Cups', sku: null, barcode: 'B-333', currentQuantity: 5 });
const ITEMS = [OK_ITEM, WARN_ITEM, CRIT_ITEM];

describe('ItemListComponent', () => {
  let inventory: {
    getInventoryItemsPaged: ReturnType<typeof vi.fn>;
    deleteInventoryItem: ReturnType<typeof vi.fn>;
    restoreInventoryItem: ReturnType<typeof vi.fn>;
  };
  let alerts: {
    error: ReturnType<typeof vi.fn>;
    errorUnauthorized: ReturnType<typeof vi.fn>;
    successRestored: ReturnType<typeof vi.fn>;
  };
  let auth: { canWriteItems: ReturnType<typeof vi.fn>; canWriteStockMovements: ReturnType<typeof vi.fn> };
  let listState: { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.fn>;

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: auth },
        { provide: ListStateService, useValue: listState },
      ],
    });
  }

  function create(detect = true) {
    configure();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(ItemListComponent);
    if (detect) {
      fixture.detectChanges();
    }
    return { fixture, vm: internals(fixture.componentInstance) };
  }

  function paged(items: ItemDto[], totalCount = items.length): PagedResultDto<ItemDto> {
    return { items, page: 1, pageSize: 25, totalCount, facets: { ok: 1, warning: 1, critical: 1 } };
  }

  const lastQuery = (): Record<string, unknown> => inventory.getInventoryItemsPaged.mock.calls.at(-1)![0];

  beforeEach(() => {
    inventory = {
      getInventoryItemsPaged: vi.fn(() => of(paged(ITEMS))),
      deleteInventoryItem: vi.fn(() => of(undefined)),
      restoreInventoryItem: vi.fn(() => of(undefined)),
    };
    alerts = { error: vi.fn(), errorUnauthorized: vi.fn(), successRestored: vi.fn() };
    auth = { canWriteItems: vi.fn(() => true), canWriteStockMovements: vi.fn(() => true) };
    listState = { load: vi.fn((_key: string, fallback: unknown) => fallback), save: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('linked product count', () => {
    const link = (id: string, isActive: boolean, productIsActive?: boolean) =>
      ({ id, productId: id, productName: id, productCode: id, itemId: 'x', quantityPerSale: 1, isActive, productIsActive }) as never;

    it('counts only active links to products that still exist', () => {
      const { vm } = create();
      const item = makeItem({
        productLinks: [link('a', true, true), link('b', false, true), link('c', true, false), link('d', true)],
      });
      expect(vm['linkedProductCount'](item)).toBe(2);
    });

    it('is zero for an item with no links', () => {
      const { vm } = create();
      expect(vm['linkedProductCount'](makeItem())).toBe(0);
    });
  });

  describe('loading', () => {
    it('asks for the first page of 25 with every status', () => {
      create();
      expect(lastQuery()).toEqual({
        searchTerm: null,
        stockStatuses: ['ok', 'warning', 'critical'],
        sortBy: null,
        sortDirection: 'asc',
        page: 1,
        pageSize: 25,
      });
    });

    it('stores loaded items and clears the loading flag', () => {
      const { vm } = create();
      expect(vm['items']()).toEqual(ITEMS);
      expect(vm['totalCount']()).toBe(3);
      expect(vm['isLoading']()).toBe(false);
    });

    it('shows a spinner while loading', () => {
      const pending = new Subject<PagedResultDto<ItemDto>>();
      inventory.getInventoryItemsPaged.mockReturnValue(pending);
      const { fixture, vm } = create();
      expect(vm['isLoading']()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).not.toBeNull();
    });

    it('alerts and stops loading on error', () => {
      inventory.getInventoryItemsPaged.mockReturnValue(throwError(() => new Error('boom')));
      const { vm } = create();
      expect(alerts.error).toHaveBeenCalledWith('boom');
      expect(vm['isLoading']()).toBe(false);
      expect(vm['isRefreshing']()).toBe(false);
    });

    it('refresh sets the refreshing flag then clears it after reloading', () => {
      const { vm } = create();
      const pending = new Subject<PagedResultDto<ItemDto>>();
      inventory.getInventoryItemsPaged.mockReturnValue(pending);
      vm['refresh']();
      expect(vm['isRefreshing']()).toBe(true);
      pending.next(paged(ITEMS));
      expect(vm['isRefreshing']()).toBe(false);
    });

    it('renders an empty state when there are no items', () => {
      inventory.getInventoryItemsPaged.mockReturnValue(of(paged([])));
      const { fixture } = create();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('No');
    });

    it('renders item names', () => {
      const { fixture } = create();
      const text = (fixture.nativeElement as HTMLElement).textContent!;
      expect(text).toContain('Alpha Milk');
      expect(text).toContain('Gamma Cups');
    });
  });

  describe('paging', () => {
    it('starts on the page in the address', () => {
      TestBed.configureTestingModule({});
      const { vm } = create();
      expect(vm['page']()).toBe(1);
    });

    it('shows the pagination bar and loads the chosen page', () => {
      inventory.getInventoryItemsPaged.mockReturnValue(of(paged(ITEMS, 60)));
      const { fixture, vm } = create();
      expect((fixture.nativeElement as HTMLElement).querySelector('app-pagination')).not.toBeNull();

      vm['goToPage'](2);

      expect(lastQuery()['page']).toBe(2);
    });

    it('goes back to page 1 when the rows per page change', () => {
      const { vm } = create();
      vm['goToPage'](2);

      vm['changePageSize'](50);

      expect(lastQuery()).toMatchObject({ page: 1, pageSize: 50 });
      expect(listState.save).toHaveBeenLastCalledWith('inventory:item-list', expect.objectContaining({ pageSize: 50 }));
    });

    it('follows the page the server returns when the page was past the end', () => {
      inventory.getInventoryItemsPaged.mockReturnValue(of({ ...paged(ITEMS, 30), page: 2 }));
      const { vm } = create();
      expect(vm['page']()).toBe(2);
    });

    it('dims the rows while another page loads', () => {
      inventory.getInventoryItemsPaged.mockReturnValue(of(paged(ITEMS, 60)));
      const { fixture, vm } = create();
      inventory.getInventoryItemsPaged.mockReturnValue(new Subject());

      vm['goToPage'](2);
      fixture.detectChanges();

      expect(vm['isReloading']()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).querySelector('.opacity-60')).not.toBeNull();
    });
  });

  describe('stock status', () => {
    it.each([
      [100, 'ok'],
      [51, 'ok'],
      [50, 'warning'],
      [11, 'warning'],
      [10, 'critical'],
      [0, 'critical'],
    ])('quantity %i with warning 50 / critical 10 is %s', (qty, status) => {
      const { vm } = create();
      expect(vm['getStockStatus'](makeItem({ currentQuantity: qty }))).toBe(status);
    });

    it('is ok when no thresholds are configured', () => {
      const { vm } = create();
      const item = makeItem({ warningQuantity: null, criticalQuantity: undefined, currentQuantity: 0 });
      expect(vm['getStockStatus'](item)).toBe('ok');
    });

    it('treats a critical threshold of 0 as set', () => {
      const { vm } = create();
      const item = makeItem({ warningQuantity: null, criticalQuantity: 0, currentQuantity: 0 });
      expect(vm['getStockStatus'](item)).toBe('critical');
    });

    it('shows the chip counts the server sent as filter options', () => {
      const { vm } = create();
      expect(vm['statusOptions']()).toEqual([
        { id: 'ok', label: 'OK', count: 1 },
        { id: 'warning', label: 'Warning', count: 1 },
        { id: 'critical', label: 'Critical', count: 1 },
      ]);
    });
  });

  describe('status filtering', () => {
    it('toggling a status asks the server again from page 1 and persists the selection', () => {
      const { vm } = create();
      vm['goToPage'](3);
      vm['toggleStatusSelection']('critical');
      expect(vm['isStatusSelected']('critical')).toBe(false);
      expect(lastQuery()).toMatchObject({ stockStatuses: ['ok', 'warning'], page: 1 });
      expect(listState.save).toHaveBeenLastCalledWith('inventory:item-list', {
        searchTerm: '',
        selectedStatuses: ['ok', 'warning'],
        pageSize: 25,
      });
      vm['toggleStatusSelection']('critical');
      expect(vm['isStatusSelected']('critical')).toBe(true);
    });

    it('clearing all statuses sends none (the server treats that as every item)', () => {
      const { vm } = create();
      vm['clearStatusSelections']();
      expect(vm['selectedStatuses']()).toEqual([]);
      expect(lastQuery()['stockStatuses']).toEqual([]);
      expect(listState.save).toHaveBeenCalled();
    });

    it('opens and closes the filter drawer', () => {
      const { vm } = create();
      vm['openFilters']();
      expect(vm['isFiltersOpen']()).toBe(true);
      vm['closeFilters']();
      expect(vm['isFiltersOpen']()).toBe(false);
    });
  });

  describe('search', () => {
    it('searches on the server after a 300ms pause and returns to page 1', () => {
      vi.useFakeTimers();
      const { vm } = create();
      vm['goToPage'](2);
      const calls = inventory.getInventoryItemsPaged.mock.calls.length;

      vm['filterForm'].controls.searchTerm.setValue(' mil ');
      vi.advanceTimersByTime(299);
      expect(inventory.getInventoryItemsPaged.mock.calls.length).toBe(calls);
      vi.advanceTimersByTime(1);

      expect(lastQuery()).toMatchObject({ searchTerm: 'mil', page: 1 });
      expect(listState.save).toHaveBeenLastCalledWith('inventory:item-list', {
        searchTerm: ' mil ',
        selectedStatuses: ['ok', 'warning', 'critical'],
        pageSize: 25,
      });
    });

    it('restores a persisted search term and status selection and sends them', () => {
      listState.load.mockReturnValue({ searchTerm: 'sugar', selectedStatuses: ['warning'], pageSize: 50 });
      const { vm } = create();
      expect(listState.load).toHaveBeenCalledWith('inventory:item-list', expect.any(Object));
      expect(vm['filterForm'].controls.searchTerm.value).toBe('sugar');
      expect(lastQuery()).toMatchObject({ searchTerm: 'sugar', stockStatuses: ['warning'], pageSize: 50 });
    });
  });

  describe('quantities and units', () => {
    it('converts to stock units when a conversion factor exists', () => {
      const { vm } = create();
      const item = makeItem({ currentQuantity: 5000, stockUnitName: 'kilogram', unitsPerStockUnit: 1000 });
      expect(vm['getStockQuantity'](item)).toBe(5);
      expect(vm['shouldShowBaseQuantity'](item)).toBe(true);
    });

    it('shows the base quantity when there is no stock unit', () => {
      const { vm } = create();
      expect(vm['getStockQuantity'](makeItem({ currentQuantity: 7 }))).toBe(7);
      expect(vm['shouldShowBaseQuantity'](makeItem())).toBe(false);
    });

    it('ignores a non-positive conversion factor', () => {
      const { vm } = create();
      const item = makeItem({ currentQuantity: 7, stockUnitName: 'box', unitsPerStockUnit: 0 });
      expect(vm['getStockQuantity'](item)).toBe(7);
      expect(vm['shouldShowBaseQuantity'](item)).toBe(false);
    });

    it('resolves unit abbreviations', () => {
      const { vm } = create();
      expect(vm['getBaseUnitAbbreviation'](makeItem({ unitName: 'gram' }))).toBe('g');
      expect(vm['getStockUnitAbbreviation'](makeItem({ unitName: 'gram', stockUnitName: 'kilogram' }))).toBe('kg');
      expect(vm['getStockUnitAbbreviation'](makeItem({ unitName: 'gram' }))).toBe('g');
    });
  });

  describe('navigation and permissions', () => {
    it('navigates to the item details', () => {
      const { vm } = create();
      vm['navigateToDetails']('abc');
      expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryItemDetailsById('abc'));
    });

    it('navigates to stock-in when permitted', () => {
      const { vm } = create();
      vm['navigateToStockIn']();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.InventoryStockIn);
    });

    it('refuses stock-in without permission', () => {
      auth.canWriteStockMovements.mockReturnValue(false);
      const { vm } = create();
      vm['navigateToStockIn']();
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('shows the add button only to item writers', () => {
      const { fixture } = create();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Add Item');
      TestBed.resetTestingModule();
      auth.canWriteItems.mockReturnValue(false);
      const second = create();
      expect((second.fixture.nativeElement as HTMLElement).textContent).not.toContain('Add Item');
    });
  });

  describe('delete flow', () => {
    it('opens the confirm dialog and registers on the modal stack', () => {
      const { fixture, vm } = create();
      vm['deleteItem'](OK_ITEM);
      fixture.detectChanges();
      expect(vm['showDeleteModal']()).toBe(true);
      expect(vm['itemToDelete']()).toBe(OK_ITEM);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delete Item?');
    });

    it('is blocked for users without write permission', () => {
      auth.canWriteItems.mockReturnValue(false);
      const { vm } = create();
      vm['deleteItem'](OK_ITEM);
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(vm['showDeleteModal']()).toBe(false);
    });

    it('cancel closes the dialog and the modal stack entry', () => {
      const { vm } = create();
      vm['deleteItem'](OK_ITEM);
      vm['cancelDelete']();
      expect(vm['showDeleteModal']()).toBe(false);
      expect(vm['itemToDelete']()).toBeNull();
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('the hardware back button cancels the dialog', () => {
      const { vm } = create();
      vm['deleteItem'](OK_ITEM);
      TestBed.inject(ModalStackService).pop();
      expect(vm['showDeleteModal']()).toBe(false);
    });

    it('confirm deletes, closes the dialog and reloads', () => {
      const { vm } = create();
      vm['deleteItem'](OK_ITEM);
      inventory.getInventoryItemsPaged.mockClear();
      vm['confirmDelete']();
      expect(inventory.deleteInventoryItem).toHaveBeenCalledWith('ok');
      expect(vm['showDeleteModal']()).toBe(false);
      expect(vm['isDeleting']()).toBe(false);
      expect(inventory.getInventoryItemsPaged).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('confirm without a selected item does nothing', () => {
      const { vm } = create();
      vm['confirmDelete']();
      expect(inventory.deleteInventoryItem).not.toHaveBeenCalled();
    });

    it('confirm is ignored while a delete is in flight and cancel is blocked', () => {
      const pending = new Subject<void>();
      inventory.deleteInventoryItem.mockReturnValue(pending);
      const { vm } = create();
      vm['deleteItem'](OK_ITEM);
      vm['confirmDelete']();
      vm['confirmDelete']();
      expect(inventory.deleteInventoryItem).toHaveBeenCalledTimes(1);
      expect(vm['isDeleting']()).toBe(true);
      vm['cancelDelete']();
      expect(vm['showDeleteModal']()).toBe(true);
    });

    it('confirm re-checks permission', () => {
      const { vm } = create();
      vm['deleteItem'](OK_ITEM);
      auth.canWriteItems.mockReturnValue(false);
      vm['confirmDelete']();
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(inventory.deleteInventoryItem).not.toHaveBeenCalled();
    });

    it('keeps the dialog open and alerts when the delete fails', () => {
      inventory.deleteInventoryItem.mockReturnValue(throwError(() => new Error('in use')));
      const { vm } = create();
      vm['deleteItem'](OK_ITEM);
      vm['confirmDelete']();
      expect(alerts.error).toHaveBeenCalledWith('in use');
      expect(vm['isDeleting']()).toBe(false);
      expect(vm['showDeleteModal']()).toBe(true);
    });
  });

  describe('restore flow', () => {
    const inactive = makeItem({ id: 'gone', name: 'Old Item', isActive: false });

    it('opens the restore dialog', () => {
      const { fixture, vm } = create();
      vm['restoreItem'](inactive);
      fixture.detectChanges();
      expect(vm['showRestoreModal']()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Restore Item?');
    });

    it('is blocked without permission', () => {
      auth.canWriteItems.mockReturnValue(false);
      const { vm } = create();
      vm['restoreItem'](inactive);
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(vm['showRestoreModal']()).toBe(false);
    });

    it('cancel closes the dialog', () => {
      const { vm } = create();
      vm['restoreItem'](inactive);
      vm['cancelRestore']();
      expect(vm['showRestoreModal']()).toBe(false);
      expect(vm['itemToRestore']()).toBeNull();
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('confirm restores, announces success and reloads', () => {
      const { vm } = create();
      vm['restoreItem'](inactive);
      inventory.getInventoryItemsPaged.mockClear();
      vm['confirmRestore']();
      expect(inventory.restoreInventoryItem).toHaveBeenCalledWith('gone');
      expect(alerts.successRestored).toHaveBeenCalledWith('Item');
      expect(vm['showRestoreModal']()).toBe(false);
      expect(inventory.getInventoryItemsPaged).toHaveBeenCalledTimes(1);
    });

    it('confirm without a selected item does nothing', () => {
      const { vm } = create();
      vm['confirmRestore']();
      expect(inventory.restoreInventoryItem).not.toHaveBeenCalled();
    });

    it('ignores confirm while restoring and blocks cancel', () => {
      const pending = new Subject<void>();
      inventory.restoreInventoryItem.mockReturnValue(pending);
      const { vm } = create();
      vm['restoreItem'](inactive);
      vm['confirmRestore']();
      vm['confirmRestore']();
      expect(inventory.restoreInventoryItem).toHaveBeenCalledTimes(1);
      vm['cancelRestore']();
      expect(vm['showRestoreModal']()).toBe(true);
    });

    it('alerts and keeps the dialog on failure', () => {
      inventory.restoreInventoryItem.mockReturnValue(throwError(() => new Error('nope')));
      const { vm } = create();
      vm['restoreItem'](inactive);
      vm['confirmRestore']();
      expect(alerts.error).toHaveBeenCalledWith('nope');
      expect(vm['isRestoring']()).toBe(false);
      expect(vm['showRestoreModal']()).toBe(true);
    });

    it('confirm re-checks permission', () => {
      const { vm } = create();
      vm['restoreItem'](inactive);
      auth.canWriteItems.mockReturnValue(false);
      vm['confirmRestore']();
      expect(alerts.errorUnauthorized).toHaveBeenCalled();
      expect(inventory.restoreInventoryItem).not.toHaveBeenCalled();
    });
  });
  describe('filter count on the Filters button', () => {
    it('counts the chosen stock statuses, and none when all are chosen', () => {
      const { fixture, vm } = create();
      expect(vm['activeFilterCount']()).toBe(0);

      vm['selectedStatuses'].set(['ok']);
      fixture.detectChanges();
      expect(vm['activeFilterCount']()).toBe(1);
      expect(fixture.nativeElement.querySelector('[data-filter-count]').textContent.trim()).toBe('1');

      vm['selectedStatuses'].set(['ok', 'warning']);
      expect(vm['activeFilterCount']()).toBe(2);
    });
  });



  describe('sorting from the column headers', () => {
    it('keeps the server order until a column is picked', () => {
      create();
      expect(lastQuery()['sortBy']).toBeNull();
    });

    it('asks the server to sort, reverses on a second pick and returns to page 1', () => {
      const { vm } = create();
      vm['goToPage'](3);

      vm['toggleSort']('name');
      expect(lastQuery()).toMatchObject({ sortBy: 'name', sortDirection: 'asc', page: 1 });

      vm['toggleSort']('name');
      expect(vm['sortDirection']()).toBe('desc');
      expect(lastQuery()).toMatchObject({ sortBy: 'name', sortDirection: 'desc' });
    });

    it('sorts by stock, status and cost on the server', () => {
      const { vm } = create();
      for (const column of ['stock', 'status', 'cost'] as const) {
        vm['toggleSort'](column);
        expect(lastQuery()).toMatchObject({ sortBy: column, sortDirection: 'asc' });
      }
    });

    it('starts a newly picked column ascending', () => {
      const { vm } = create();
      vm['toggleSort']('name');
      vm['toggleSort']('name');
      vm['toggleSort']('stock');
      expect(vm['sortDirection']()).toBe('asc');
    });
  });
});
