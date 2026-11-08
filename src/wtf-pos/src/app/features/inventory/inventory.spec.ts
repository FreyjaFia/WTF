import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, StockAttentionService, StockWasteService } from '@core/services';
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
              { path: 'waste', component: StockStub },
              { path: 'purchase-orders', component: StockStub },
              { path: 'purchase-orders/suggestions', component: StockStub },
              { path: 'ingredients', component: StockStub },
            ],
          },
        ]),
        {
          provide: AuthService,
          useValue: {
            canReadItems: () => perms.items,
            canReadStockMovements: () => perms.stock,
            canReviewStockWaste: () => false,
          },
        },
        { provide: StockAttentionService, useValue: { count: unread, urgentCount: signal(1), start: refresh, stop: vi.fn() } },
        {
          provide: StockWasteService,
          useValue: { pendingCount: signal(0), startPendingCount: vi.fn(), stopPendingCount: vi.fn() },
        },
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

  const selectedTabs = (el: HTMLElement): (string | null)[] =>
    tabs(el)
      .filter((t) => t.getAttribute('aria-selected') === 'true')
      .map((t) => t.getAttribute('data-inventory-tab'));

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
      'ingredients',
      'attention',
      'purchase-orders',
      'receiving',
      'stock-in',
      'waste',
      'counts',
    ]);
    expect(rendered.map((t) => t.getAttribute('href'))).toEqual([
      '/inventory/items',
      '/inventory/ingredients',
      '/inventory/attention',
      '/inventory/purchase-orders',
      '/inventory/receiving',
      '/inventory/stock-in',
      '/inventory/waste',
      '/inventory/counts',
    ]);
  });

  it('keeps the Purchasing tab active on the suggested orders view', async () => {
    const { el } = await setup('/inventory/purchase-orders/suggestions');
    expect(selectedTabs(el)).toEqual(['purchase-orders']);
  });

  it('hides tabs the user cannot read', async () => {
    perms = { items: false, stock: true };
    const { el } = await setup('/inventory/stock-in');
    expect(tabs(el).map((t) => t.getAttribute('data-inventory-tab'))).toEqual(['attention', 'purchase-orders', 'receiving', 'stock-in', 'waste', 'counts']);
  });

  it('shows the ingredients tab only to roles that can read items', async () => {
    perms = { items: true, stock: false };
    const { el } = await setup();
    expect(tabs(el).map((t) => t.getAttribute('data-inventory-tab'))).toEqual(['items', 'ingredients']);
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
    expect(selectedTabs(el)).toEqual(['items']);
  });

  it('updates the selected tab after navigation and shows the routed page', async () => {
    const { harness, el } = await setup('/inventory/items');
    expect(el.textContent).toContain('items page');
    await harness.navigateByUrl('/inventory/stock-in');
    harness.detectChanges();
    expect(selectedTabs(el)).toEqual(['stock-in']);
    expect(el.textContent).toContain('stock page');
  });

  it('scrolls the active tab into view after routing', async () => {
    const { el } = await setup('/inventory/stock-in');
    const scroll = vi.fn();
    tabs(el).find((t) => t.getAttribute('data-inventory-tab') === 'stock-in')!.scrollIntoView = scroll;
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
