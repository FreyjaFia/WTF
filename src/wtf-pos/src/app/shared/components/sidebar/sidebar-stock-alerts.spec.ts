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
      showInventory: { set: (open: boolean) => void };
      isCollapsed: { set: (collapsed: boolean) => void };
    };
    return { fixture, el, unread, refresh, labels, vm };
  }

  it('shows a Needs Attention link for roles that can read stock, and starts watching', async () => {
    const { labels, refresh } = await setup();

    expect(labels().some((label) => label.startsWith('Needs Attention'))).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('hides the link and does not ask for the count without the permission', async () => {
    const { labels, refresh } = await setup({ canRead: false });

    expect(labels().some((label) => label.startsWith('Needs Attention'))).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shows the unread count only while there is one', async () => {
    const { fixture, el, unread } = await setup();
    expect(el.querySelector('[data-testid="sidebar-alerts-badge"]')).toBeNull();

    unread.set(4);
    fixture.detectChanges(false);

    expect(el.querySelector('[data-testid="sidebar-alerts-badge"]')?.textContent?.trim()).toBe('4');
  });

  it('shows the count on the Inventory entry while its group is closed', async () => {
    const { fixture, el, vm } = await setup({ unread: 3 });
    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')).toBeNull();

    vm.showInventory.set(false);
    fixture.detectChanges(false);

    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')?.textContent?.trim()).toBe('3');
  });

  it('shows no Inventory count when there is nothing unread', async () => {
    const { fixture, el, vm } = await setup({ unread: 0 });
    vm.showInventory.set(false);
    fixture.detectChanges(false);

    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')).toBeNull();
  });

  it('narrow sidebar, group open: the number sits on the Alerts icon only', async () => {
    const { fixture, el, vm } = await setup({ unread: 5 });
    vm.isCollapsed.set(true);
    fixture.detectChanges(false);

    expect(el.querySelector('[data-testid="sidebar-alerts-rail-badge"]')?.textContent?.trim()).toBe('5');
    expect(el.querySelector('[data-testid="sidebar-inventory-rail-badge"]')).toBeNull();
    expect(el.querySelector('[data-testid="sidebar-alerts-badge"]')).toBeNull();
    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')).toBeNull();
  });

  it('narrow sidebar, group closed: the number moves to the Inventory icon', async () => {
    const { fixture, el, vm } = await setup({ unread: 5 });
    vm.isCollapsed.set(true);
    vm.showInventory.set(false);
    fixture.detectChanges(false);

    expect(el.querySelector('[data-testid="sidebar-inventory-rail-badge"]')?.textContent?.trim()).toBe('5');
    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')).toBeNull();
  });

  it('wide sidebar, group open: the count is on Alerts and not on Inventory', async () => {
    const { el } = await setup({ unread: 5 });

    expect(el.querySelector('[data-testid="sidebar-alerts-badge"]')?.textContent?.trim()).toBe('5');
    expect(el.querySelector('[data-testid="sidebar-inventory-badge"]')).toBeNull();
  });

  it('caps the number on the narrow icons at 9+', async () => {
    const { fixture, el, vm } = await setup({ unread: 14 });
    vm.isCollapsed.set(true);
    fixture.detectChanges(false);

    expect(el.querySelector('[data-testid="sidebar-alerts-rail-badge"]')?.textContent?.trim()).toBe('9+');
  });

  it('shows no rail numbers while the sidebar is wide', async () => {
    const { el } = await setup({ unread: 5 });

    expect(el.querySelector('[data-testid="sidebar-inventory-rail-badge"]')).toBeNull();
    expect(el.querySelector('[data-testid="sidebar-alerts-rail-badge"]')).toBeNull();
  });
});
