import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, StockAttentionService } from '@core/services';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DockComponent } from './dock';

describe('DockComponent: items that need attention', () => {
  function setup(options: { canRead?: boolean; unread?: number; urgent?: number } = {}) {
    const unread = signal(options.unread ?? 0);
    const urgent = signal(options.urgent ?? 1);
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
        { provide: StockAttentionService, useValue: { count: unread, urgentCount: urgent, start: refresh, stop: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(DockComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, unread, urgent, refresh };
  }

  it('shows the count of items needing attention on the Inventory item, so it is visible on a phone', () => {
    const { el } = setup({ unread: 4 });
    const badge = el.querySelector('[data-testid="dock-inventory-badge"]');

    expect(badge?.textContent?.trim()).toBe('4');
    expect(badge?.closest('a')?.textContent).toContain('Inventory');
  });

  it('shows no badge when nothing needs attention, and follows the count as it changes', () => {
    const { fixture, el, unread } = setup({ unread: 0 });
    expect(el.querySelector('[data-testid="dock-inventory-badge"]')).toBeNull();

    unread.set(2);
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="dock-inventory-badge"]')?.textContent?.trim()).toBe('2');
  });

  it('is red while something is critical or out, and amber when items are only running low', () => {
    const { fixture, el, urgent } = setup({ unread: 2, urgent: 1 });
    const badge = () => el.querySelector('[data-testid="dock-inventory-badge"]') as HTMLElement;
    expect(badge().className).toContain('bg-red-500');
    expect(badge().className).not.toContain('bg-amber-500');

    urgent.set(0);
    fixture.detectChanges();

    expect(badge().className).toContain('bg-amber-500');
    expect(badge().className).not.toContain('bg-red-500');
  });

  it('starts watching once for roles that can read stock, and not for others', () => {
    expect(setup().refresh).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();

    expect(setup({ canRead: false }).refresh).not.toHaveBeenCalled();
  });
});
