import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, StockAlertService } from '@core/services';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DockComponent } from './dock';

describe('DockComponent: stock alerts', () => {
  function setup(options: { canRead?: boolean; unread?: number } = {}) {
    const unread = signal(options.unread ?? 0);
    const refresh = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: AuthService,
          useValue: {
            isLoggedIn$: new BehaviorSubject(true),
            canReadManagement: () => false,
            canWriteOrders: () => false,
            canReadOrders: () => false,
            canReadInventory: () => true,
            canReadStockMovements: () => options.canRead ?? true,
          },
        },
        { provide: StockAlertService, useValue: { unread, refresh } },
      ],
    });
    const fixture = TestBed.createComponent(DockComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, unread, refresh };
  }

  it('shows the unread count on the Inventory item, so it is visible on a phone', () => {
    const { el } = setup({ unread: 4 });
    const badge = el.querySelector('[data-testid="dock-inventory-badge"]');

    expect(badge?.textContent?.trim()).toBe('4');
    expect(badge?.closest('a')?.textContent).toContain('Inventory');
  });

  it('shows no badge when nothing is unread, and follows the count as it changes', () => {
    const { fixture, el, unread } = setup({ unread: 0 });
    expect(el.querySelector('[data-testid="dock-inventory-badge"]')).toBeNull();

    unread.set(2);
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="dock-inventory-badge"]')?.textContent?.trim()).toBe('2');
  });

  it('asks for the count once for roles that can read stock, and not for others', () => {
    expect(setup().refresh).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();

    expect(setup({ canRead: false }).refresh).not.toHaveBeenCalled();
  });
});
