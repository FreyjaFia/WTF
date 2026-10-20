import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AlertService, InventoryService, StockAttentionService } from '@core/services';
import { ItemDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StockInComponent } from './stock-in';

const item = (id: string, name: string, quantity: number, overrides: Partial<ItemDto> = {}) =>
  ({ id, name, unitName: 'ml', currentQuantity: quantity, warningQuantity: 500, criticalQuantity: 200, ...overrides }) as ItemDto;

const milk = item('item-1', 'Milk', 500);
const beans = item('item-2', 'Beans', 9000, { unitName: 'g' });
const gone = item('item-3', 'Syrup', 0);
const critical = item('item-4', 'Cups', 150, { unitName: 'piece' });

interface StockInVm {
  form: { patchValue: (value: object) => void };
  save: () => void;
}

describe('StockInComponent', () => {
  function setup(options: { itemId?: string; addStock?: unknown; items?: ItemDto[] } = {}) {
    const inventory = {
      getInventoryItems: vi.fn().mockReturnValue(of(options.items ?? [milk])),
      addStock: vi.fn().mockReturnValue(options.addStock ?? of({ ...milk, currentQuantity: 1500 })),
    };
    const alerts = { success: vi.fn(), error: vi.fn() };
    const attention = { items: signal([]), start: vi.fn(), stop: vi.fn(), refresh: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: StockAttentionService, useValue: attention },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(options.itemId ? { itemId: options.itemId } : {}),
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(StockInComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tiles = () => [...el.querySelectorAll('[data-testid="item-tile"]')] as HTMLButtonElement[];
    return { fixture, inventory, alerts, attention, el, tiles };
  }

  it('is a page: a heading, the item grid, the quantity, the details and a summary beside them', () => {
    const { el } = setup();

    expect(el.querySelector('h1')?.textContent).toContain('Stock In');
    expect(el.textContent).toContain('1. What arrived?');
    expect(el.textContent).toContain('2. How much?');
    expect(el.textContent).toContain('3. Details');
    expect(el.querySelector('[data-testid="summary"]')).not.toBeNull();
    expect(el.querySelector('.card')).toBeNull();
  });

  it('lists every active item as a tile', () => {
    const { tiles } = setup({ items: [milk, beans] });

    expect(tiles().map((t) => t.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Milk 500 ml · running low',
      'Beans 9,000 g',
    ]);
  });

  it('puts the items that need stock first, worst first, then the rest by name', () => {
    const { tiles } = setup({ items: [beans, critical, milk, gone] });

    expect(tiles().map((t) => t.getAttribute('data-level'))).toEqual(['out', 'critical', 'low', 'ok']);
  });

  it('narrows the tiles by name or code, and says so when nothing matches', () => {
    const { fixture, el, tiles } = setup({ items: [milk, beans] });
    const input = el.querySelector('app-search-input input') as HTMLInputElement;

    input.value = 'bea';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0].textContent).toContain('Beans');

    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="no-items"]')).not.toBeNull();
  });

  it('preselects the item from the query string', () => {
    const { el, tiles } = setup({ itemId: 'item-1' });

    expect(tiles()[0].getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('[data-testid="summary-item"]')?.textContent).toContain('Milk');
    expect(el.querySelector('[data-testid="in-stock-now"]')?.textContent).toContain('500');
  });

  it('asks to choose an item while none is chosen', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="summary-empty"]')).not.toBeNull();
  });

  it('choosing a tile selects it and shows it in the summary', () => {
    const { fixture, el, tiles } = setup({ items: [milk, beans] });

    tiles()[1].click();
    fixture.detectChanges();

    expect(tiles()[1].getAttribute('aria-pressed')).toBe('true');
    expect(tiles()[0].getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('[data-testid="summary-item"]')?.textContent).toContain('Beans');
  });

  it('does not save without an item and a quantity', () => {
    const { fixture, inventory, el } = setup();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(inventory.addStock).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Choose the item that arrived.');
  });

  it('adds the stock, lists it under "Added just now" and is ready for the next delivery', () => {
    const { fixture, inventory, alerts, attention, el, tiles } = setup({ itemId: 'item-1' });
    const component = fixture.componentInstance as unknown as StockInVm;
    component.form.patchValue({ quantity: 1000, unitCost: 0.15, notes: ' delivery ' });
    component.save();

    expect(inventory.addStock).toHaveBeenCalledWith({
      itemId: 'item-1',
      quantity: 1000,
      unitCost: 0.15,
      notes: 'delivery',
    });
    expect(alerts.success).toHaveBeenCalledWith('Stock added.');
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="recent"]')?.textContent).toContain('+1,000 ml');
    expect(el.querySelector('[data-testid="recent"]')?.textContent).toContain('now 1,500 ml');
    expect(tiles()[0].getAttribute('aria-pressed')).toBe('false');
    expect(tiles()[0].textContent).toContain('1,500 ml');
    expect(attention.refresh).toHaveBeenCalled();
  });

  it('shows the error and stays when saving fails', () => {
    const { fixture, alerts, el } = setup({
      itemId: 'item-1',
      addStock: throwError(() => new Error('Nope')),
    });
    const component = fixture.componentInstance as unknown as StockInVm;
    component.form.patchValue({ quantity: 5 });
    component.save();

    expect(alerts.error).toHaveBeenCalledWith('Nope');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="recent"]')).toBeNull();
  });

  it('previews what is in stock, what is received and the new balance while a quantity is typed', () => {
    const { fixture, el } = setup({ itemId: 'item-1' });
    const component = fixture.componentInstance as unknown as StockInVm;
    expect(el.querySelector('[data-testid="balance-after"]')?.textContent?.trim()).toBe('—');

    component.form.patchValue({ quantity: 1000 });
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="receiving"]')?.textContent).toContain('+1,000 ml');
    expect(el.querySelector('[data-testid="balance-after"]')?.textContent).toContain('1,500 ml');
  });

  it('adds a preset on top of what is typed, with sizes that suit the unit', () => {
    const { fixture, el } = setup({ itemId: 'item-1' });
    const component = fixture.componentInstance as unknown as StockInVm;
    component.form.patchValue({ quantity: 250 });
    fixture.detectChanges();
    const presets = () => [...el.querySelectorAll('[data-testid="preset"]')] as HTMLButtonElement[];
    expect(presets().map((p) => p.textContent?.trim())).toEqual(['+100', '+500', '+1,000', '+5,000']);

    presets()[1].click();
    fixture.detectChanges();

    expect((el.querySelector('#stock-in-quantity') as HTMLInputElement).value).toBe('750');
  });

  it('offers small presets for pieces', () => {
    const { el } = setup({ itemId: 'item-4', items: [critical] });

    expect([...el.querySelectorAll('[data-testid="preset"]')].map((p) => p.textContent?.trim())).toEqual(['+1', '+5', '+10', '+50']);
  });

  it('keeps cost and note on the page, ready to fill in', () => {
    const { el } = setup({ itemId: 'item-1' });

    expect(el.querySelector('#stock-in-cost')).not.toBeNull();
    expect(el.querySelector('#stock-in-notes')).not.toBeNull();
  });

  it('starts and stops watching stock with the page', () => {
    const { fixture, attention } = setup();
    expect(attention.start).toHaveBeenCalledTimes(1);

    fixture.destroy();

    expect(attention.stop).toHaveBeenCalledTimes(1);
  });
});
