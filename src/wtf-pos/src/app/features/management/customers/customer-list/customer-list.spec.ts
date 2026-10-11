import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AlertService, AuthService, CustomerService, ListStateService } from '@core/services';
import { CustomerDto } from '@shared/models';
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

describe('CustomerListComponent', () => {
  let fixture: ComponentFixture<CustomerListComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let listState: ReturnType<typeof fakeListState>;
  let router: Router;

  function setup(
    opts: { saved?: unknown; canWrite?: boolean; getCustomers?: ReturnType<typeof vi.fn> } = {},
  ) {
    alert = fakeAlert();
    listState = fakeListState(opts.saved);
    const auth = { canWriteCustomers: vi.fn(() => opts.canWrite ?? true) };
    service = {
      getCustomers: opts.getCustomers ?? vi.fn(() => of(DATA)),
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

  it('loads customers and shows active ones sorted by name by default', () => {
    setup();
    expect(service['getCustomers']).toHaveBeenCalledTimes(1);
    expect(c.isLoading()).toBe(false);
    expect(ids(c.sortedCustomers())).toEqual(['2', '1']);
    expect(c.statusCounts()).toEqual({ active: 2, inactive: 1 });
    expect(c.statusOptions().map((o: { count: number }) => o.count)).toEqual([2, 1]);
  });

  it('renders rows and the Add button when allowed', () => {
    setup();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Alice Smith');
    expect(text).toContain('Add Customer');
    expect(text).not.toContain('Carl Gone');
  });

  it('hides write UI without permission', () => {
    setup({ canWrite: false });
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).not.toContain('Add Customer');
    expect(fixture.nativeElement.querySelector('[aria-label="Customer actions"]')).toBeNull();
  });

  it('shows the empty state when nothing matches', () => {
    setup({ getCustomers: vi.fn(() => of([])) });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No customers found');
  });

  it('alerts on load error and clears loading flags', () => {
    setup({ getCustomers: vi.fn(() => throwError(() => new Error('boom'))) });
    expect(alert.error).toHaveBeenCalledWith('boom');
    expect(c.isLoading()).toBe(false);
    expect(c.isRefreshing()).toBe(false);
  });

  it('shows the spinner while loading', () => {
    const subject = new Subject<CustomerDto[]>();
    setup({ getCustomers: vi.fn(() => subject) });
    expect(c.isLoading()).toBe(true);
    expect(fixture.nativeElement.querySelector('.loading-spinner')).not.toBeNull();
    subject.next(DATA);
    expect(c.isLoading()).toBe(false);
  });

  it('refresh reloads and clears the refreshing flag', () => {
    setup();
    c.refresh();
    expect(service['getCustomers']).toHaveBeenCalledTimes(2);
    expect(c.isRefreshing()).toBe(false);
  });

  it('restores persisted state', () => {
    setup({
      saved: {
        searchTerm: 'bob',
        selectedStatuses: ['inactive'],
        sortColumn: 'address',
        sortDirection: 'desc',
      },
    });
    expect(c.filterForm.controls.searchTerm.value).toBe('bob');
    expect(c.selectedStatuses()).toEqual(['inactive']);
    expect(c.sortColumn()).toBe('address');
    expect(c.sortDirection()).toBe('desc');
  });

  describe('filtering', () => {
    it('search is debounced, case-insensitive, matches full name, and persists state', () => {
      setup();
      c.filterForm.controls.searchTerm.setValue('ALICE s');
      fixture.destroy();
      fixture.detectChanges();
      vi.advanceTimersByTime(299);
      expect(c.customers().length).toBe(2);
      vi.advanceTimersByTime(1);
      expect(ids(c.customers())).toEqual(['2']);
      expect(listState.save).toHaveBeenCalledWith(
        'management:customer-list',
        expect.objectContaining({ searchTerm: 'ALICE s' }),
      );
    });

    it('whitespace-only search does not filter', () => {
      setup();
      c.filterForm.controls.searchTerm.setValue('   ');
      fixture.destroy();
      fixture.detectChanges();
      vi.advanceTimersByTime(300);
      expect(c.customers().length).toBe(2);
    });

    it('toggling statuses filters and persists', () => {
      setup();
      c.toggleStatusSelection('inactive');
      expect(c.customers().length).toBe(3);
      c.toggleStatusSelection('active');
      expect(ids(c.customers())).toEqual(['3']);
      expect(c.isStatusSelected('inactive')).toBe(true);
      expect(c.isStatusSelected('active')).toBe(false);
      expect(listState.save).toHaveBeenCalledTimes(2);
    });

    it('clearing statuses shows everything', () => {
      setup();
      c.clearStatusSelections();
      expect(c.customers().length).toBe(3);
      c.onStatusFilterChange(['active']);
      expect(c.customers().length).toBe(2);
      c.onStatusFilterReset();
      expect(c.customers().length).toBe(3);
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
    it('toggles direction on the same column and resets on a new one', () => {
      setup();
      c.toggleSort('name');
      expect(c.sortDirection()).toBe('desc');
      expect(ids(c.sortedCustomers())).toEqual(['1', '2']);
      c.toggleSort('address');
      expect(c.sortColumn()).toBe('address');
      expect(c.sortDirection()).toBe('asc');
      expect(ids(c.sortedCustomers())).toEqual(['2', '1']);
      expect(listState.save).toHaveBeenLastCalledWith(
        'management:customer-list',
        expect.objectContaining({ sortColumn: 'address', sortDirection: 'asc' }),
      );
    });

    it('handles missing addresses and no sort column', () => {
      setup({
        getCustomers: vi.fn(() =>
          of([customer('1', 'A', 'A', true, ''), customer('2', 'B', 'B', true, 'x')]),
        ),
      });
      c.sortColumn.set('address');
      expect(ids(c.sortedCustomers())).toEqual(['1', '2']);
      c.sortColumn.set(null);
      expect(c.sortedCustomers().length).toBe(2);
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
      expect(service['getCustomers']).toHaveBeenCalledTimes(2);
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
      expect(service['getCustomers']).toHaveBeenCalledTimes(2);
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
});
