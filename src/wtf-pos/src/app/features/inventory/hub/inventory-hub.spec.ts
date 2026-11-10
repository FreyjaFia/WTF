import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, StockAttentionService, StockWasteService } from '@core/services';
import { beforeEach, describe, expect, it } from 'vitest';
import { InventoryHubComponent } from './inventory-hub';

describe('InventoryHubComponent', () => {
  let perms: { items: boolean; stock: boolean; review: boolean };
  let attention: ReturnType<typeof signal<number>>;
  let urgent: ReturnType<typeof signal<number>>;
  let pending: ReturnType<typeof signal<number>>;

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            canReadItems: () => perms.items,
            canReadStockMovements: () => perms.stock,
            canReviewStockWaste: () => perms.review,
          },
        },
        { provide: StockAttentionService, useValue: { count: attention, urgentCount: urgent } },
        { provide: StockWasteService, useValue: { pendingCount: pending } },
      ],
    });
    const fixture = TestBed.createComponent(InventoryHubComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const ids = (el: HTMLElement): (string | null)[] =>
    Array.from(el.querySelectorAll('[data-testid^="inventory-card-"]')).map(
      (a) => a.getAttribute('data-testid')?.replace('inventory-card-', '') ?? null,
    );
  const headings = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('h2')).map((h) => h.textContent?.trim() ?? '');

  beforeEach(() => {
    perms = { items: true, stock: true, review: true };
    attention = signal(0);
    urgent = signal(0);
    pending = signal(0);
  });

  it('shows every card in two groups for a stock manager', () => {
    const el = render();
    expect(headings(el)).toEqual(['Stock', 'Buying']);
    expect(ids(el)).toEqual([
      'items',
      'ingredients',
      'attention',
      'stock-in',
      'counts',
      'waste',
      'purchase-orders',
      'receiving',
    ]);
    expect(el.querySelector('[data-testid="inventory-card-items"]')?.getAttribute('href')).toBe(
      '/inventory/items',
    );
  });

  it('shows only the item cards to a role that cannot read stock movements', () => {
    perms.stock = false;
    const el = render();
    expect(headings(el)).toEqual(['Stock']);
    expect(ids(el)).toEqual(['items', 'ingredients']);
  });

  it('shows only the stock cards to a role that cannot read items', () => {
    perms.items = false;
    const el = render();
    expect(ids(el)).toEqual([
      'attention',
      'stock-in',
      'counts',
      'waste',
      'purchase-orders',
      'receiving',
    ]);
  });

  it('shows nothing without any permission', () => {
    perms = { items: false, stock: false, review: false };
    const el = render();
    expect(ids(el)).toEqual([]);
    expect(headings(el)).toEqual([]);
  });

  it('shows the attention count only while there is one', () => {
    let el = render();
    expect(
      el.querySelector('[data-testid="inventory-card-attention"] [data-testid="card-badge"]'),
    ).toBeNull();
    TestBed.resetTestingModule();

    attention = signal(4);
    el = render();
    expect(
      el
        .querySelector('[data-testid="inventory-card-attention"] [data-testid="card-badge"]')
        ?.textContent?.trim(),
    ).toBe('4');
  });

  it('shows pending waste only to reviewers', () => {
    pending = signal(2);
    let el = render();
    expect(
      el
        .querySelector('[data-testid="inventory-card-waste"] [data-testid="card-badge"]')
        ?.textContent?.trim(),
    ).toBe('2');
    TestBed.resetTestingModule();

    perms.review = false;
    el = render();
    expect(
      el.querySelector('[data-testid="inventory-card-waste"] [data-testid="card-badge"]'),
    ).toBeNull();
  });

  it('shows an icon on every card, taken from the card list', () => {
    const el = render();
    const cards = Array.from(el.querySelectorAll('[data-testid^="inventory-card-"]'));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const href = card.querySelector('app-icon use')?.getAttribute('xlink:href');
      expect(href).toMatch(/^#icon-/);
    }
  });
});
