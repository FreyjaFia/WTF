import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService, StockAttentionService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DockComponent } from './dock';

describe('DockComponent', () => {
  type Perms = Partial<
    Record<
      'canReadManagement' | 'canWriteOrders' | 'canReadOrders' | 'canReadInventory',
      boolean
    >
  >;

  function setup(loggedIn: boolean, perms: Perms = {}) {
    const isLoggedIn$ = new BehaviorSubject<boolean>(loggedIn);
    const fake = {
      isLoggedIn$,
      canReadManagement: () => perms.canReadManagement ?? false,
      canWriteOrders: () => perms.canWriteOrders ?? false,
      canReadOrders: () => perms.canReadOrders ?? false,
      canReadInventory: () => perms.canReadInventory ?? false,
      canReadStockMovements: () => false,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: AuthService, useValue: fake },
        { provide: StockAttentionService, useValue: { count: signal(0), urgentCount: signal(0), start: vi.fn(), stop: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(DockComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const labels = () => [...el.querySelectorAll('.dock-label')].map((l) => l.textContent!.trim());
    const router = TestBed.inject(Router);
    const activeLabels = () =>
      [...el.querySelectorAll('a.dock-active .dock-label')].map((l) => l.textContent!.trim());
    return { fixture, el, isLoggedIn$, labels, router, activeLabels };
  }

  it('renders nothing when logged out', () => {
    const { el } = setup(false, { canReadManagement: true });
    expect(el.querySelector('.dock')).toBeNull();
  });

  it('renders an empty dock when logged in without permissions', () => {
    const { el, labels } = setup(true);
    expect(el.querySelector('.dock')).toBeTruthy();
    expect(labels()).toEqual([]);
  });

  it('shows all entries in order with full permissions', () => {
    const { labels } = setup(true, {
      canReadManagement: true,
      canWriteOrders: true,
      canReadOrders: true,
      canReadInventory: true,
    });
    expect(labels()).toEqual(['Dashboard', 'New Order', 'Orders', 'Inventory', 'Management']);
  });

  it('shows only cashier-style entries', () => {
    const { labels } = setup(true, { canWriteOrders: true, canReadOrders: true });
    expect(labels()).toEqual(['New Order', 'Orders']);
  });

  it('links to the configured routes', () => {
    const { el } = setup(true, { canReadOrders: true });
    const href = el.querySelector('a')!.getAttribute('href');
    expect(href).toBe(AppRoutes.OrdersList);
  });

  describe('which order entry is lit', () => {
    const full = { canWriteOrders: true, canReadOrders: true };

    it.each([
      ['/orders/list', ['Orders']],
      ['/orders/details/abc', ['Orders']],
      ['/orders/editor/abc', ['New Order']],
      ['/orders/editor?offline=OFF-1', ['New Order']],
      ['/orders/editor', ['New Order']],
    ])('at %s', async (url, expected) => {
      const { fixture, router, activeLabels } = setup(true, full);
      await router.navigateByUrl(url);
      fixture.detectChanges();
      expect(activeLabels()).toEqual(expected);
    });
  });

  it('hides the dock after logout', () => {
    const { fixture, el, isLoggedIn$ } = setup(true, { canReadOrders: true });
    isLoggedIn$.next(false);
    fixture.detectChanges();
    expect(el.querySelector('.dock')).toBeNull();
  });
});
