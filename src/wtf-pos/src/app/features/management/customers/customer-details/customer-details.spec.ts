import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AlertService, AuthService, CustomerService } from '@core/services';
import { CustomerDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeAlert,
  internals,
  Internals,
  stubRoute,
} from '../../../../testing/management-spec-helpers';
import { CustomerDetailsComponent } from './customer-details';

const ACTIVE: CustomerDto = {
  id: 'c1',
  firstName: 'Ann',
  lastName: 'Lee',
  address: '12 Main St',
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  createdBy: 'x',
};
const INACTIVE: CustomerDto = { ...ACTIVE, isActive: false, address: null };

describe('CustomerDetailsComponent', () => {
  let fixture: ComponentFixture<CustomerDetailsComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(
    opts: { id?: string | null; canWrite?: boolean; customer?: CustomerDto; get?: unknown } = {},
  ) {
    alert = fakeAlert();
    service = {
      getCustomer: vi.fn(() => opts.get ?? of(opts.customer ?? ACTIVE)),
      deleteCustomer: vi.fn(() => of(void 0)),
      restoreCustomer: vi.fn(() => of(void 0)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CustomerService, useValue: service },
        { provide: AlertService, useValue: alert },
        { provide: AuthService, useValue: { canWriteCustomers: () => opts.canWrite ?? true } },
        {
          provide: ActivatedRoute,
          useValue: stubRoute(opts.id === null ? {} : { id: opts.id ?? 'c1' }),
        },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(CustomerDetailsComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('loads and renders the customer', () => {
    setup();
    expect(service['getCustomer']).toHaveBeenCalledWith('c1');
    expect(c.customer()).toEqual(ACTIVE);
    expect(text()).toContain('Ann Lee');
    expect(text()).toContain('12 Main St');
    expect(text()).toContain('Edit');
    expect(text()).toContain('Delete');
  });

  it('does not load without an id', () => {
    setup({ id: null });
    expect(service['getCustomer']).not.toHaveBeenCalled();
    expect(c.customer()).toBeNull();
  });

  it('shows a spinner while loading', () => {
    setup({ get: new Subject<CustomerDto>() });
    expect(c.isLoading()).toBe(true);
    expect(fixture.nativeElement.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('alerts on load error', () => {
    setup({ get: throwError(() => new Error('missing')) });
    expect(alert.error).toHaveBeenCalledWith('missing');
    expect(c.isLoading()).toBe(false);
    expect(c.customer()).toBeNull();
  });

  it('hides actions without permission', () => {
    setup({ canWrite: false });
    expect(text()).not.toContain('Delete');
    expect(text()).not.toContain('Edit');
  });

  it('inactive customers show Restore instead of Edit/Delete', () => {
    setup({ customer: INACTIVE });
    expect(text()).toContain('Restore');
    expect(text()).toContain('Inactive');
    expect(text()).not.toContain('Delete');
  });

  it('goBack and navigateToEdit navigate', () => {
    setup();
    c.goBack();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/management/customers');
    c.navigateToEdit();
    expect(router.navigateByUrl).toHaveBeenLastCalledWith(expect.stringContaining('c1'));
  });

  it('navigateToEdit is blocked without permission', () => {
    setup({ canWrite: false });
    c.navigateToEdit();
    expect(alert.errorUnauthorized).toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  describe('delete', () => {
    it('opens the modal, cancels, then confirms and navigates back', () => {
      setup();
      c.deleteCustomer();
      fixture.detectChanges();
      expect(c.showDeleteModal()).toBe(true);
      expect(text()).toContain('Delete Customer?');
      c.cancelDelete();
      expect(c.showDeleteModal()).toBe(false);

      c.deleteCustomer();
      c.confirmDelete();
      expect(service['deleteCustomer']).toHaveBeenCalledWith('c1');
      expect(alert.successDeleted).toHaveBeenCalledWith('Customer');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/management/customers');
      expect(c.showDeleteModal()).toBe(false);
    });

    it('falls back to a default message when the error has none', () => {
      setup();
      service['deleteCustomer'].mockReturnValue(throwError(() => new Error('')));
      c.deleteCustomer();
      c.confirmDelete();
      expect(alert.error).toHaveBeenCalledWith('Failed to delete customer.');
      expect(c.isDeleting()).toBe(false);
    });

    it('shows the server error message', () => {
      setup();
      service['deleteCustomer'].mockReturnValue(throwError(() => new Error('in use')));
      c.deleteCustomer();
      c.confirmDelete();
      expect(alert.error).toHaveBeenCalledWith('in use');
    });

    it('ignores cancel/confirm while deleting', () => {
      setup();
      service['deleteCustomer'].mockReturnValue(new Subject<void>());
      c.deleteCustomer();
      c.confirmDelete();
      c.confirmDelete();
      c.cancelDelete();
      expect(service['deleteCustomer']).toHaveBeenCalledTimes(1);
      expect(c.showDeleteModal()).toBe(true);
    });

    it('is blocked without permission', () => {
      setup({ canWrite: false });
      c.deleteCustomer();
      c.confirmDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(alert.errorUnauthorized).toHaveBeenCalledTimes(2);
      expect(service['deleteCustomer']).not.toHaveBeenCalled();
    });

    it('no-ops when no customer is loaded', () => {
      setup({ id: null });
      c.deleteCustomer();
      c.confirmDelete();
      expect(c.showDeleteModal()).toBe(false);
      expect(service['deleteCustomer']).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('restores and reloads the customer', () => {
      setup({ customer: INACTIVE });
      c.restoreCustomer();
      fixture.detectChanges();
      expect(text()).toContain('Restore Customer?');
      c.confirmRestore();
      expect(service['restoreCustomer']).toHaveBeenCalledWith('c1');
      expect(alert.successRestored).toHaveBeenCalledWith('Customer');
      expect(service['getCustomer']).toHaveBeenCalledTimes(2);
      expect(c.showRestoreModal()).toBe(false);
    });

    it('cancel closes the modal', () => {
      setup({ customer: INACTIVE });
      c.restoreCustomer();
      c.cancelRestore();
      expect(c.showRestoreModal()).toBe(false);
    });

    it('alerts on failure', () => {
      setup({ customer: INACTIVE });
      service['restoreCustomer'].mockReturnValue(throwError(() => new Error('bad')));
      c.restoreCustomer();
      c.confirmRestore();
      expect(alert.error).toHaveBeenCalledWith('bad');
      expect(c.isRestoring()).toBe(false);
    });

    it('ignores cancel/confirm while restoring', () => {
      setup({ customer: INACTIVE });
      service['restoreCustomer'].mockReturnValue(new Subject<void>());
      c.restoreCustomer();
      c.confirmRestore();
      c.confirmRestore();
      c.cancelRestore();
      expect(service['restoreCustomer']).toHaveBeenCalledTimes(1);
      expect(c.showRestoreModal()).toBe(true);
    });

    it('is blocked without permission', () => {
      setup({ canWrite: false, customer: INACTIVE });
      c.restoreCustomer();
      c.confirmRestore();
      expect(alert.errorUnauthorized).toHaveBeenCalledTimes(2);
      expect(service['restoreCustomer']).not.toHaveBeenCalled();
    });

    it('no-ops when no customer is loaded', () => {
      setup({ id: null });
      c.restoreCustomer();
      c.confirmRestore();
      expect(c.showRestoreModal()).toBe(false);
      expect(service['restoreCustomer']).not.toHaveBeenCalled();
    });
  });
});
