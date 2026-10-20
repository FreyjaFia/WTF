import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, StockAttentionService } from '@core/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryComponent } from './inventory';

@Component({ selector: 'app-stub-a', template: 'items page' })
class ItemsStub {}

@Component({ selector: 'app-stub-b', template: 'stock page' })
class StockStub {}

interface Scrollable {
  scrollInventoryTabIntoView: (route: string) => void;
}

describe('InventoryComponent', () => {
  let perms: { items: boolean; stock: boolean };
  let unread: ReturnType<typeof signal<number>>;
  let refresh: ReturnType<typeof vi.fn>;

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'inventory',
            component: InventoryComponent,
            children: [
              { path: 'items', component: ItemsStub },
              { path: 'stock-in', component: StockStub },
              { path: 'attention', component: StockStub },
              { path: 'coverage', component: StockStub },
            ],
          },
        ]),
        {
          provide: AuthService,
          useValue: {
            canReadItems: () => perms.items,
            canReadStockMovements: () => perms.stock,
          },
        },
        { provide: StockAttentionService, useValue: { count: unread, urgentCount: signal(1), start: refresh, stop: vi.fn() } },
      ],
    });
  }

  async function setup(url = '/inventory/items') {
    configure();
    const harness = await RouterTestingHarness.create(url);
    const el = harness.routeNativeElement as HTMLElement;
    return { harness, el };
  }

  const tabs = (el: HTMLElement): HTMLAnchorElement[] =>
    Array.from(el.querySelectorAll<HTMLAnchorElement>('a[role="tab"]'));

  beforeEach(() => {
    perms = { items: true, stock: true };
    unread = signal(0);
    refresh = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders every tab with links when the user can read items and stock', async () => {
    const { el } = await setup();
    const rendered = tabs(el);
    expect(rendered.map((t) => t.getAttribute('data-inventory-tab'))).toEqual([
      'items',
      'stock-in',
      'attention',
      'coverage',
    ]);
    expect(rendered.map((t) => t.getAttribute('href'))).toEqual([
      '/inventory/items',
      '/inventory/stock-in',
      '/inventory/attention',
      '/inventory/coverage',
    ]);
  });

  it('hides tabs the user cannot read', async () => {
    perms = { items: false, stock: true };
    const { el } = await setup('/inventory/stock-in');
    expect(tabs(el).map((t) => t.getAttribute('data-inventory-tab'))).toEqual(['stock-in', 'attention']);
  });

  it('shows the coverage tab only to roles that can read items', async () => {
    perms = { items: true, stock: false };
    const { el } = await setup();
    expect(tabs(el).map((t) => t.getAttribute('data-inventory-tab'))).toEqual(['items', 'coverage']);
  });

  it('shows the count of items needing attention on the Needs Attention tab only while there are some', async () => {
    const { harness, el } = await setup();
    expect(el.querySelector('[data-testid="tab-badge"]')).toBeNull();

    unread.set(3);
    harness.detectChanges();

    const badge = el.querySelector('[data-testid="tab-badge"]');
    expect(badge?.textContent?.trim()).toBe('3');
    expect(badge?.closest('a')?.getAttribute('data-inventory-tab')).toBe('attention');
  });

  it('starts watching stock for roles that can read stock, and not for others', async () => {
    await setup();
    expect(refresh).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    refresh = vi.fn();
    perms = { items: true, stock: false };
    await setup();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('renders no tabs without any permission', async () => {
    perms = { items: false, stock: false };
    const { el } = await setup();
    expect(tabs(el)).toHaveLength(0);
  });

  it('marks only the active route as selected', async () => {
    const { el } = await setup('/inventory/items');
    expect(tabs(el).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('updates the selected tab after navigation and shows the routed page', async () => {
    const { harness, el } = await setup('/inventory/items');
    expect(el.textContent).toContain('items page');
    await harness.navigateByUrl('/inventory/stock-in');
    harness.detectChanges();
    expect(tabs(el).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    expect(el.textContent).toContain('stock page');
  });

  it('scrolls the active tab into view after routing', async () => {
    const { el } = await setup('/inventory/stock-in');
    const scroll = vi.fn();
    tabs(el)[1].scrollIntoView = scroll;
    vi.runAllTimers();
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });

  it('does not throw when the tab element to scroll is missing', () => {
    configure();
    const component = TestBed.createComponent(InventoryComponent)
      .componentInstance as unknown as Scrollable;
    component.scrollInventoryTabIntoView('nope');
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});
