import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';
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
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: fake }],
    });
    const fixture = TestBed.createComponent(DockComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const labels = () => [...el.querySelectorAll('.dock-label')].map((l) => l.textContent!.trim());
    return { fixture, el, isLoggedIn$, labels };
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

  it('hides the dock after logout', () => {
    const { fixture, el, isLoggedIn$ } = setup(true, { canReadOrders: true });
    isLoggedIn$.next(false);
    fixture.detectChanges();
    expect(el.querySelector('.dock')).toBeNull();
  });
});
