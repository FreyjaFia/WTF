import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AlertService, AuthService, CustomerService, OrderLinkService } from '@core/services';
import { CustomerDto, OrderLinkDto } from '@shared/models';
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
  allowOrderingLink: false,
};
const INACTIVE: CustomerDto = { ...ACTIVE, isActive: false, address: null };
const ENABLED: CustomerDto = { ...ACTIVE, allowOrderingLink: true };
const LINK: OrderLinkDto = {
  id: 'l1',
  token: 'tok123',
  status: 'Active',
  createdAt: '2026-10-01T00:00:00Z',
  createdByName: 'Cara Shier',
  expiresAt: null,
};

describe('CustomerDetailsComponent', () => {
  let fixture: ComponentFixture<CustomerDetailsComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let linkService: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(
    opts: {
      id?: string | null;
      canWrite?: boolean;
      canManageLinks?: boolean;
      customer?: CustomerDto;
      get?: unknown;
      links?: OrderLinkDto[];
    } = {},
  ) {
    alert = fakeAlert();
    service = {
      getCustomer: vi.fn(() => opts.get ?? of(opts.customer ?? ACTIVE)),
      deleteCustomer: vi.fn(() => of(void 0)),
      restoreCustomer: vi.fn(() => of(void 0)),
    };
    linkService = {
      getLinks: vi.fn(() => of(opts.links ?? [])),
      createLink: vi.fn(() => of(LINK)),
      revokeLink: vi.fn(() => of(void 0)),
      setAccess: vi.fn((_id: string, allow: boolean) =>
        of({ allowOrderingLink: allow, revokedLinks: 0 }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CustomerService, useValue: service },
        { provide: OrderLinkService, useValue: linkService },
        { provide: AlertService, useValue: alert },
        {
          provide: AuthService,
          useValue: {
            canWriteCustomers: () => opts.canWrite ?? true,
            canManageOrderLinks: () => opts.canManageLinks ?? true,
          },
        },
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

  describe('ordering link', () => {
    it('hides the section without permission', () => {
      setup({ canManageLinks: false });
      expect(text()).not.toContain('Ordering link');
    });

    it('hides the section for inactive customers', () => {
      setup({ customer: INACTIVE });
      expect(text()).not.toContain('Ordering link');
    });

    it('shows the toggle but no links while ordering is off', () => {
      setup();
      expect(text()).toContain('Allow ordering link');
      expect(text()).not.toContain('Generate Link');
      expect(linkService['getLinks']).not.toHaveBeenCalled();
    });

    it('shows how many orders each link has produced', () => {
      setup({
        customer: ENABLED,
        links: [
          { ...LINK, id: 'l1', ordersCount: 3 },
          { ...LINK, id: 'l2', ordersCount: 1 },
          { ...LINK, id: 'l3', ordersCount: 0 },
          { ...LINK, id: 'l4', ordersCount: undefined },
        ],
      });
      const counts = [...fixture.nativeElement.querySelectorAll('[data-link-orders]')].map(
        (n: Element) => n.textContent!.trim(),
      );
      expect(counts).toEqual(['3 orders', '1 order', '0 orders', '0 orders']);
    });

    it('loads and lists the links when ordering is on', () => {
      setup({ customer: ENABLED, links: [LINK] });
      expect(linkService['getLinks']).toHaveBeenCalledWith('c1');
      expect(text()).toContain('Generate Link');
      expect(text()).toContain('Active');
      expect(text()).toContain('Cara Shier');
      expect(text()).toContain('No end date');
      expect(text()).toContain('Never used');
    });

    it('shows an empty message when there are no links', () => {
      setup({ customer: ENABLED });
      expect(text()).toContain('No links yet.');
    });

    it('only offers Copy and Revoke on active links', () => {
      setup({
        customer: ENABLED,
        links: [
          { ...LINK, id: 'l2', status: 'Expired', expiresAt: '2026-10-02T00:00:00Z' },
          { ...LINK, id: 'l3', status: 'Revoked', revokedAt: '2026-10-03T00:00:00Z' },
        ],
      });
      expect(text()).toContain('Expired');
      expect(text()).toContain('Revoked');
      expect(text()).not.toContain('Copy');
    });

    it('alerts when the links fail to load', () => {
      setup();
      linkService['getLinks'].mockReturnValue(throwError(() => new Error('nope')));
      c.onOrderingToggle(true);
      expect(alert.error).toHaveBeenCalledWith('nope');
      expect(c.isLoadingLinks()).toBe(false);
    });

    it('enables ordering straight away and loads the links', () => {
      setup();
      c.onOrderingToggle(true);
      expect(linkService['setAccess']).toHaveBeenCalledWith('c1', true);
      expect(c.customer().allowOrderingLink).toBe(true);
      expect(alert.success).toHaveBeenCalledWith('Ordering links enabled.');
      expect(linkService['getLinks']).toHaveBeenCalledWith('c1');
    });

    it('asks before disabling, then disables', () => {
      setup({ customer: ENABLED });
      c.onOrderingToggle(false);
      fixture.detectChanges();
      expect(c.showDisableOrderingModal()).toBe(true);
      expect(linkService['setAccess']).not.toHaveBeenCalled();
      expect(text()).toContain('Disable Ordering Link?');

      c.confirmDisableOrdering();
      expect(linkService['setAccess']).toHaveBeenCalledWith('c1', false);
      expect(c.customer().allowOrderingLink).toBe(false);
      expect(c.showDisableOrderingModal()).toBe(false);
      expect(alert.success).toHaveBeenCalledWith(
        'Ordering links disabled. All links were revoked.',
      );
    });

    it('cancelling the disable dialog changes nothing', () => {
      setup({ customer: ENABLED });
      c.onOrderingToggle(false);
      c.cancelDisableOrdering();
      expect(c.showDisableOrderingModal()).toBe(false);
      expect(linkService['setAccess']).not.toHaveBeenCalled();
    });

    it('shows the server error when the toggle fails and keeps the dialog open', () => {
      setup({ customer: ENABLED });
      linkService['setAccess'].mockReturnValue(throwError(() => new Error('boom')));
      c.onOrderingToggle(false);
      c.confirmDisableOrdering();
      expect(alert.error).toHaveBeenCalledWith('boom');
      expect(c.isUpdatingAccess()).toBe(false);
      expect(c.showDisableOrderingModal()).toBe(true);
      expect(c.customer().allowOrderingLink).toBe(true);
    });

    it('ignores the toggle while an update is running', () => {
      setup();
      linkService['setAccess'].mockReturnValue(new Subject());
      c.onOrderingToggle(true);
      c.onOrderingToggle(true);
      c.confirmDisableOrdering();
      expect(linkService['setAccess']).toHaveBeenCalledTimes(1);
    });

    it('blocks the toggle without permission', () => {
      setup({ canManageLinks: false });
      c.onOrderingToggle(true);
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(linkService['setAccess']).not.toHaveBeenCalled();
    });

    it('generates a link without an end date and puts it first in the list', () => {
      setup({ customer: ENABLED, links: [{ ...LINK, id: 'old' }] });
      c.generateLink();
      expect(linkService['createLink']).toHaveBeenCalledWith('c1', null);
      expect(c.orderLinks()[0].id).toBe('l1');
      expect(c.orderLinks().length).toBe(2);
      expect(alert.success).toHaveBeenCalledWith('Ordering link created.');
    });

    it('sends the end date as the end of that day and clears the field', () => {
      setup({ customer: ENABLED });
      c.newLinkEndDate.set('2099-12-31');
      c.generateLink();
      const sent = linkService['createLink'].mock.calls[0][1] as string;
      expect(new Date(sent).getTime()).toBe(new Date('2099-12-31T23:59:59').getTime());
      expect(c.newLinkEndDate()).toBe('');
    });

    it('shows the error when generating fails and does not double submit', () => {
      setup({ customer: ENABLED });
      linkService['createLink'].mockReturnValue(throwError(() => new Error('bad date')));
      c.generateLink();
      expect(alert.error).toHaveBeenCalledWith('bad date');
      expect(c.isCreatingLink()).toBe(false);

      linkService['createLink'].mockReturnValue(new Subject());
      c.generateLink();
      c.generateLink();
      expect(linkService['createLink']).toHaveBeenCalledTimes(2);
    });

    it('blocks generating without permission', () => {
      setup({ customer: ENABLED, canManageLinks: false });
      c.generateLink();
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(linkService['createLink']).not.toHaveBeenCalled();
    });

    it('revokes after confirming and reloads the list', () => {
      setup({ customer: ENABLED, links: [LINK] });
      c.askRevokeLink(LINK);
      fixture.detectChanges();
      expect(text()).toContain('Revoke Link?');
      c.confirmRevokeLink();
      expect(linkService['revokeLink']).toHaveBeenCalledWith('c1', 'l1');
      expect(c.linkToRevoke()).toBeNull();
      expect(alert.success).toHaveBeenCalledWith('Ordering link revoked.');
      expect(linkService['getLinks']).toHaveBeenCalledTimes(2);
    });

    it('cancelling the revoke dialog keeps the link', () => {
      setup({ customer: ENABLED, links: [LINK] });
      c.askRevokeLink(LINK);
      c.cancelRevokeLink();
      expect(c.linkToRevoke()).toBeNull();
      expect(linkService['revokeLink']).not.toHaveBeenCalled();
    });

    it('keeps the revoke dialog open and shows the error when revoking fails', () => {
      setup({ customer: ENABLED, links: [LINK] });
      linkService['revokeLink'].mockReturnValue(throwError(() => new Error('gone')));
      c.askRevokeLink(LINK);
      c.confirmRevokeLink();
      expect(alert.error).toHaveBeenCalledWith('gone');
      expect(c.isRevokingLink()).toBe(false);
      expect(c.linkToRevoke()).not.toBeNull();
    });

    it('blocks revoking without permission', () => {
      setup({ customer: ENABLED, canManageLinks: false });
      c.askRevokeLink(LINK);
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(c.linkToRevoke()).toBeNull();
    });

    it('builds the link address from the page origin', () => {
      setup({ customer: ENABLED });
      expect(c.orderLinkUrl('abc')).toBe(`${window.location.origin}/shop/abc`);
    });

    it('copies the full link to the clipboard', async () => {
      setup({ customer: ENABLED, links: [LINK] });
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      await c.copyLink(LINK);
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/shop/tok123`);
      expect(alert.success).toHaveBeenCalledWith('Link copied.');
      vi.unstubAllGlobals();
    });

    it('alerts when the clipboard is not available', async () => {
      setup({ customer: ENABLED, links: [LINK] });
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('x')) },
      });
      await c.copyLink(LINK);
      expect(alert.error).toHaveBeenCalledWith('Unable to copy the link.');
      vi.unstubAllGlobals();
    });
  });
});
