import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AlertService, AuthService, CustomerService, ListStateService } from '@core/services';
import { CustomerDto, PagedResultDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeAlert,
  fakeListState,
  internals,
  Internals,
} from '../../../../testing/management-spec-helpers';
import { CustomerListComponent } from './customer-list';

function customer(
  id: string,
  first: string,
  last: string,
  isActive = true,
  address = '',
): CustomerDto {
  return {
    id,
    firstName: first,
    lastName: last,
    address,
    isActive,
    createdAt: '2024-01-01',
    createdBy: 'x',
    allowOrderingLink: false,
  };
}

const DATA = [
  customer('1', 'Bob', 'Zed', true, 'B street'),
  customer('2', 'Alice', 'Smith', true, 'A street'),
  customer('3', 'Carl', 'Gone', false, 'C street'),
];

const ids = (list: CustomerDto[]) => list.map((x) => x.id);

const paged = (
  items: CustomerDto[],
  page = 1,
  totalCount = items.length,
  facets?: Record<string, number>,
): PagedResultDto<CustomerDto> => ({ items, page, pageSize: 25, totalCount, facets });

describe('CustomerListComponent', () => {
  let fixture: ComponentFixture<CustomerListComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let listState: ReturnType<typeof fakeListState>;
  let router: Router;
  const lastQuery = () => service['getCustomersPaged'].mock.lastCall![0];

  function setup(
    opts: {
      saved?: unknown;
      canWrite?: boolean;
      getCustomersPaged?: ReturnType<typeof vi.fn>;
    } = {},
  ) {
    alert = fakeAlert();
    listState = fakeListState(opts.saved);
    const auth = { canWriteCustomers: vi.fn(() => opts.canWrite ?? true) };
    service = {
      getCustomersPaged:
        opts.getCustomersPaged ??
        vi.fn(() => of(paged([DATA[1], DATA[0]], 1, 2, { active: 2, inactive: 1 }))),
      deleteCustomer: vi.fn(() => of(void 0)),
      restoreCustomer: vi.fn(() => of(void 0)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CustomerService, useValue: service },
        { provide: AlertService, useValue: alert },
        { provide: AuthService, useValue: auth },
        { provide: ListStateService, useValue: listState },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(CustomerListComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the first page for active customers sorted by name by default', () => {
    setup();
    expect(service['getCustomersPaged']).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 25,
        isActive: true,
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    );
    expect(c.isLoading()).toBe(false);
    expect(ids(c.customers())).toEqual(['2', '1']);
    expect(c.statusCounts()).toEqual({ active: 2, inactive: 1 });
    expect(c.statusOptions().map((o: { count: number }) => o.count)).toEqual([2, 1]);
  });

  it('renders rows, the Add button and the pagination bar when allowed', () => {
    setup();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Alice Smith');
    expect(text).toContain('Add Customer');
    expect(text).toContain('1 – 2 of 2');
    expect(fixture.nativeElement.querySelector('app-pagination nav')).not.toBeNull();
  });

  it('hides write UI without permission', () => {
    setup({ canWrite: false });
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).not.toContain('Add Customer');
    expect(fixture.nativeElement.querySelector('[aria-label="Customer actions"]')).toBeNull();
  });

  it('shows the empty state when nothing matches', () => {
    setup({ getCustomersPaged: vi.fn(() => of(paged([]))) });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No customers found');
  });

  it('alerts on load error and clears loading flags', () => {
    setup({ getCustomersPaged: vi.fn(() => throwError(() => new Error('boom'))) });
    expect(alert.error).toHaveBeenCalledWith('boom');
    expect(c.isLoading()).toBe(false);
    expect(c.isRefreshing()).toBe(false);
  });

  it('shows the spinner while loading', () => {
    const subject = new Subject<PagedResultDto<CustomerDto>>();
    setup({ getCustomersPaged: vi.fn(() => subject) });
    expect(c.isLoading()).toBe(true);
    expect(fixture.nativeElement.querySelector('.loading-spinner')).not.toBeNull();
    subject.next(paged(DATA));
    expect(c.isLoading()).toBe(false);
  });

  it('refresh reloads and clears the refreshing flag', () => {
    setup();
    c.refresh();
    expect(service['getCustomersPaged']).toHaveBeenCalledTimes(2);
    expect(c.isRefreshing()).toBe(false);
  });

  it('restores persisted state, including the rows per page', () => {
    setup({
      saved: {
        searchTerm: 'bob',
        selectedStatuses: ['inactive'],
        sortColumn: 'address',
        sortDirection: 'desc',
        pageSize: 50,
      },
    });
    expect(c.filterForm.controls.searchTerm.value).toBe('bob');
    expect(c.selectedStatuses()).toEqual(['inactive']);
    expect(c.sortColumn()).toBe('address');
    expect(c.sortDirection()).toBe('desc');
    expect(lastQuery()).toEqual(expect.objectContaining({ pageSize: 50, isActive: false }));
  });

  describe('paging', () => {
    it('goes to a page, keeps the filters and writes the page to the address', () => {
      setup({ getCustomersPaged: vi.fn((q: { page: number }) => of(paged(DATA, q.page, 120))) });
      c.goToPage(3);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 3, isActive: true }));
      expect(vi.mocked(router.navigate).mock.lastCall![1]!.queryParams).toEqual({ page: 3 });
    });

    it('a new page size, search, status or sort returns to page one', () => {
      setup({ getCustomersPaged: vi.fn((q: { page: number }) => of(paged(DATA, q.page, 120))) });
      c.goToPage(3);
      c.changePageSize(50);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, pageSize: 50 }));
      expect(listState.save).toHaveBeenLastCalledWith(
        'management:customer-list',
        expect.objectContaining({ pageSize: 50 }),
      );
      c.goToPage(2);
      c.toggleSort('address');
      expect(lastQuery().page).toBe(1);
      c.goToPage(2);
      c.toggleStatusSelection('inactive');
      expect(lastQuery().page).toBe(1);
      c.goToPage(2);
      c.filterForm.controls.searchTerm.setValue('x');
      fixture.destroy();
      fixture.detectChanges();
      vi.advanceTimersByTime(300);
      expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, searchTerm: 'x' }));
    });

    it('follows the page the server says it returned', () => {
      setup({ getCustomersPaged: vi.fn(() => of(paged(DATA, 2, 30))) });
      expect(c.page()).toBe(2);
    });
  });

  describe('filtering', () => {
    it('search is debounced and persists state', () => {
      setup();
      service['getCustomersPaged'].mockClear();
      c.filterForm.controls.searchTerm.setValue('ALICE s');
      fixture.destroy();
      fixture.detectChanges();
      vi.advanceTimersByTime(299);
      expect(service['getCustomersPaged']).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(lastQuery()).toEqual(expect.objectContaining({ searchTerm: 'ALICE s', page: 1 }));
      expect(listState.save).toHaveBeenCalledWith(
        'management:customer-list',
        expect.objectContaining({ searchTerm: 'ALICE s' }),
      );
    });

    it('toggling statuses asks the server and persists', () => {
      setup();
      c.toggleStatusSelection('inactive');
      expect(lastQuery().isActive).toBeUndefined();
      c.toggleStatusSelection('active');
      expect(lastQuery().isActive).toBe(false);
      expect(c.isStatusSelected('inactive')).toBe(true);
      expect(c.isStatusSelected('active')).toBe(false);
      expect(listState.save).toHaveBeenCalledTimes(2);
    });

    it('clearing statuses asks for everything', () => {
      setup();
      c.clearStatusSelections();
      expect(lastQuery().isActive).toBeUndefined();
      c.onStatusFilterChange(['active']);
      expect(lastQuery().isActive).toBe(true);
      c.onStatusFilterReset();
      expect(lastQuery().isActive).toBeUndefined();
    });

    it('opens and closes the filters drawer', () => {
      setup();
      c.openFilters();
      expect(c.isFiltersOpen()).toBe(true);
      c.closeFilters();
      expect(c.isFiltersOpen()).toBe(false);
    });
  });

  describe('sorting', () => {
    it('toggles direction on the same column and resets on a new one, on the server', () => {
      setup();
      c.toggleSort('name');
      expect(c.sortDirection()).toBe('desc');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'name', sortDirection: 'desc' }));
      c.toggleSort('address');
      expect(c.sortColumn()).toBe('address');
      expect(c.sortDirection()).toBe('asc');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'address', sortDirection: 'asc' }));
      expect(listState.save).toHaveBeenLastCalledWith(
        'management:customer-list',
        expect.objectContaining({ sortColumn: 'address', sortDirection: 'asc' }),
      );
    });
  });

  describe('navigation', () => {
    it('navigates to editor (new/edit) and details', () => {
      setup();
      c.navigateToEditor();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/management/customers/new');
      c.navigateToEditor('7');
      expect(router.navigateByUrl).toHaveBeenLastCalledWith(expect.stringContaining('7'));
      c.navigateToDetails('9');
      expect(router.navigateByUrl).toHaveBeenLastCalledWith(expect.stringContaining('9'));
    });

    it('blocks editor navigation without permission', () => {
      setup({ canWrite: false });
      c.navigateToEditor('1');
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('delete flow', () => {
    it('opens, cancels and confirms deletion', () => {
      setup();
      c.deleteCustomer(DATA[0]);
      fixture.detectChanges();
      expect(c.showDeleteModal()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delete Customer?');
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(c.customerToDelete()).toBeNull();

      c.deleteCustomer(DATA[0]);
      c.confirmDelete();
      expect(service['deleteCustomer']).toHaveBeenCalledWith('1');
      expect(c.showDeleteModal()).toBe(false);
      expect(c.isDeleting()).toBe(false);
      expect(service['getCustomersPaged']).toHaveBeenCalledTimes(2);
    });

    it('does nothing when confirming with no selection', () => {
      setup();
      c.confirmDelete();
      expect(service['deleteCustomer']).not.toHaveBeenCalled();
    });

    it('alerts on delete failure and keeps the modal open', () => {
      setup();
      service['deleteCustomer'].mockReturnValue(throwError(() => new Error('nope')));
      c.deleteCustomer(DATA[0]);
      c.confirmDelete();
      expect(alert.error).toHaveBeenCalledWith('nope');
      expect(c.isDeleting()).toBe(false);
      expect(c.showDeleteModal()).toBe(true);
    });

    it('ignores cancel and re-confirm while deleting', () => {
      setup();
      service['deleteCustomer'].mockReturnValue(new Subject<void>());
      c.deleteCustomer(DATA[0]);
      c.confirmDelete();
      c.confirmDelete();
      c.cancelDelete();
      expect(service['deleteCustomer']).toHaveBeenCalledTimes(1);
      expect(c.showDeleteModal()).toBe(true);
    });

    it('is blocked without permission', () => {
      setup({ canWrite: false });
      c.deleteCustomer(DATA[0]);
      c.confirmDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(alert.errorUnauthorized).toHaveBeenCalledTimes(2);
      expect(service['deleteCustomer']).not.toHaveBeenCalled();
    });
  });

  describe('restore flow', () => {
    it('restores an inactive customer and reloads', () => {
      setup();
      c.restoreCustomer(DATA[2]);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Restore Customer?');
      c.confirmRestore();
      expect(service['restoreCustomer']).toHaveBeenCalledWith('3');
      expect(alert.successRestored).toHaveBeenCalledWith('Customer');
      expect(c.showRestoreModal()).toBe(false);
      expect(service['getCustomersPaged']).toHaveBeenCalledTimes(2);
    });

    it('cancel closes the modal', () => {
      setup();
      c.restoreCustomer(DATA[2]);
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(false);
      expect(c.customerToRestore()).toBeNull();
    });

    it('alerts on failure', () => {
      setup();
      service['restoreCustomer'].mockReturnValue(throwError(() => new Error('bad')));
      c.restoreCustomer(DATA[2]);
      c.confirmRestore();
      expect(alert.error).toHaveBeenCalledWith('bad');
      expect(c.isRestoring()).toBe(false);
    });

    it('is blocked without permission', () => {
      setup({ canWrite: false });
      c.restoreCustomer(DATA[2]);
      c.confirmRestore();
      expect(alert.errorUnauthorized).toHaveBeenCalledTimes(2);
      expect(service['restoreCustomer']).not.toHaveBeenCalled();
    });

    it('confirm without a selected customer does nothing', () => {
      setup();
      c.confirmRestore();
      expect(service['restoreCustomer']).not.toHaveBeenCalled();
    });

    it('ignores cancel and re-confirm while restoring', () => {
      setup();
      service['restoreCustomer'].mockReturnValue(new Subject<void>());
      c.restoreCustomer(DATA[2]);
      c.confirmRestore();
      c.confirmRestore();
      c.cancelRestore();
      expect(service['restoreCustomer']).toHaveBeenCalledTimes(1);
      expect(c.showRestoreModal()).toBe(true);
    });
  });
  describe('filter count on the Filters button', () => {
    it('counts the chosen statuses, and none when all are chosen', () => {
      setup();
      expect(c.activeFilterCount()).toBe(1);
      c.selectedStatuses.set(['active', 'inactive']);
      expect(c.activeFilterCount()).toBe(0);
      c.selectedStatuses.set([]);
      expect(c.activeFilterCount()).toBe(0);
    });

    it('shows the number on the button', () => {
      setup();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-filter-count]').textContent.trim()).toBe('1');
    });
  });
});
