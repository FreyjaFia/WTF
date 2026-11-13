import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, ConnectivityService, UnsyncedOrderService } from '@core/services';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { UnsyncedOrdersBanner } from './unsynced-orders-banner';

describe('UnsyncedOrdersBanner', () => {
  function render(options: { canOverride?: boolean; online?: boolean; total?: number; fail?: boolean }) {
    const getUnsyncedOrders = vi
      .fn()
      .mockReturnValue(
        options.fail
          ? throwError(() => new Error('x'))
          : of({ items: [], page: 1, pageSize: 1, totalCount: options.total ?? 0 }),
      );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { canOverrideOrders: () => options.canOverride ?? true } },
        { provide: ConnectivityService, useValue: { isOnline: () => options.online ?? true } },
        { provide: UnsyncedOrderService, useValue: { getUnsyncedOrders } },
      ],
    });
    const fixture = TestBed.createComponent(UnsyncedOrdersBanner);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, getUnsyncedOrders };
  }

  it('links to the screen with the number of open orders', () => {
    const { el, getUnsyncedOrders } = render({ total: 3 });

    const banner = el.querySelector('[data-unsynced-banner]');
    expect(banner?.textContent).toContain('3');
    expect(banner?.textContent).toContain('unsynced orders');
    expect(banner?.getAttribute('href')).toBe('/orders/unsynced');
    expect(getUnsyncedOrders).toHaveBeenCalledWith({ status: 1, page: 1, pageSize: 1 });
  });

  it('says order in the singular', () => {
    const { el } = render({ total: 1 });

    expect(el.querySelector('[data-unsynced-banner]')?.textContent).toContain('unsynced order could');
  });

  it('shows nothing when there are none', () => {
    expect(render({ total: 0 }).el.querySelector('[data-unsynced-banner]')).toBeNull();
  });

  it('shows nothing when the count cannot be read', () => {
    expect(render({ fail: true }).el.querySelector('[data-unsynced-banner]')).toBeNull();
  });

  it('does not ask while offline', () => {
    const offline = render({ online: false, total: 2 });

    expect(offline.el.querySelector('[data-unsynced-banner]')).toBeNull();
    expect(offline.getUnsyncedOrders).not.toHaveBeenCalled();
  });

  it('does not ask without the permission', () => {
    const { el, getUnsyncedOrders } = render({ canOverride: false, total: 2 });

    expect(getUnsyncedOrders).not.toHaveBeenCalled();
    expect(el.querySelector('[data-unsynced-banner]')).toBeNull();
  });
});
