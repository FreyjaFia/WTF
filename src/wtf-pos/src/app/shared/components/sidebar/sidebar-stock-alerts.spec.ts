import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  AuthService,
  ConnectivityService,
  ConversationInboxService,
  ImageCacheService,
  StockAttentionService,
} from '@core/services';
import { describe, expect, it, vi } from 'vitest';
import { createShellFakes, flushAsync } from '../../../testing/shell-components-testing';
import { SidebarComponent } from './sidebar';

describe('SidebarComponent: items that need attention', () => {
  async function setup(options: { canRead?: boolean; unread?: number } = {}) {
    const fakes = createShellFakes();
    fakes.permissions['canReadStockMovements'] = options.canRead ?? true;
    const unread = signal(options.unread ?? 0);
    const refresh = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: fakes.auth },
        { provide: ConversationInboxService, useValue: fakes.inbox },
        { provide: ConnectivityService, useValue: fakes.connectivity },
        { provide: ImageCacheService, useValue: fakes.imageCache },
        {
          provide: StockAttentionService,
          useValue: { count: unread.asReadonly(), urgentCount: signal(1), start: refresh, stop: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges(false);
    await flushAsync();
    await fixture.whenStable();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);
    const el = fixture.nativeElement as HTMLElement;
    const labels = () => [...el.querySelectorAll('nav a')].map((a) => a.textContent!.replace(/\s+/g, ' ').trim());
    const vm = fixture.componentInstance as unknown as {
      isCollapsed: { set: (collapsed: boolean) => void };
    };
    return { fixture, el, unread, refresh, labels, vm };
  }

  it('starts watching stock for roles that can read stock, and not for others', async () => {
    const allowed = await setup();
    expect(allowed.refresh).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();

    const denied = await setup({ canRead: false });
    expect(denied.refresh).not.toHaveBeenCalled();
  });

  it('has one Inventory entry that opens the hub, with no sub-links', async () => {
    const { el } = await setup();
    const link = el.querySelector('[data-testid="sidebar-inventory"]');

    expect(link?.getAttribute('href')).toBe('/inventory');
    expect(el.querySelector('a[href="/inventory/attention"]')).toBeNull();
  });

  it('shows the count on the Inventory entry only while there is one', async () => {
    const { fixture, el, unread } = await setup();
    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')).toBeNull();

    unread.set(3);
    fixture.detectChanges(false);

    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')?.textContent?.trim()).toBe('3');
  });

  it('narrow sidebar: the number sits on the Inventory icon, capped at 9+', async () => {
    const { fixture, el, vm } = await setup({ unread: 14 });
    vm.isCollapsed.set(true);
    fixture.detectChanges(false);

    expect(el.querySelector('[data-testid="sidebar-inventory-rail-badge"]')?.textContent?.trim()).toBe('9+');
    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')).toBeNull();
  });

  it('shows no rail number while the sidebar is wide', async () => {
    const { el } = await setup({ unread: 5 });

    expect(el.querySelector('[data-testid="sidebar-inventory-rail-badge"]')).toBeNull();
  });
});
