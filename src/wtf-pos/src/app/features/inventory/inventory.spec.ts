import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, StockAttentionService, StockWasteService } from '@core/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryComponent } from './inventory';

@Component({ selector: 'app-stub-a', template: 'stub page' })
class Stub {}

describe('InventoryComponent', () => {
  let perms: { stock: boolean; review: boolean };
  let start: ReturnType<typeof vi.fn>;
  let startWaste: ReturnType<typeof vi.fn>;

  async function setup(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'inventory',
            component: InventoryComponent,
            children: [
              { path: '', component: Stub, pathMatch: 'full' },
              { path: 'items', component: Stub },
              { path: 'items/edit/:id', component: Stub },
              { path: 'purchase-orders', component: Stub },
              { path: 'purchase-orders/suggestions', component: Stub },
            ],
          },
        ]),
        {
          provide: AuthService,
          useValue: {
            canReadStockMovements: () => perms.stock,
            canReviewStockWaste: () => perms.review,
          },
        },
        { provide: StockAttentionService, useValue: { start, stop: vi.fn() } },
        {
          provide: StockWasteService,
          useValue: { pendingCount: signal(0), startPendingCount: startWaste, stopPendingCount: vi.fn() },
        },
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    return { harness, el: harness.routeNativeElement as HTMLElement };
  }

  const back = (el: HTMLElement): HTMLAnchorElement | null =>
    el.querySelector<HTMLAnchorElement>('[data-testid="inventory-back"]');

  beforeEach(() => {
    perms = { stock: true, review: true };
    start = vi.fn();
    startWaste = vi.fn();
  });

  it('has no tab bar and no way back on the hub itself', async () => {
    const { el } = await setup('/inventory');
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(back(el)).toBeNull();
    expect(el.textContent).toContain('stub page');
  });

  it('offers the way back to the hub on the top screen of a section', async () => {
    const { el } = await setup('/inventory/items');
    expect(back(el)?.getAttribute('href')).toBe('/inventory');
    expect(back(el)?.className).toContain('sm:hidden');
  });

  it('leaves deeper pages to their own back arrow and follows navigation', async () => {
    const { harness, el } = await setup('/inventory/items/edit/5');
    expect(back(el)).toBeNull();

    await harness.navigateByUrl('/inventory/purchase-orders');
    harness.detectChanges();
    expect(back(el)).not.toBeNull();

    await harness.navigateByUrl('/inventory/purchase-orders/suggestions');
    harness.detectChanges();
    expect(back(el)).toBeNull();
  });

  it('keeps watching stock for roles that can read it, and not for others', async () => {
    await setup('/inventory');
    expect(start).toHaveBeenCalledTimes(1);
    expect(startWaste).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();

    start = vi.fn();
    startWaste = vi.fn();
    perms = { stock: false, review: false };
    await setup('/inventory');
    expect(start).not.toHaveBeenCalled();
    expect(startWaste).not.toHaveBeenCalled();
  });
});
