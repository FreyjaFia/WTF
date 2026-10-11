import { TestBed } from '@angular/core/testing';
import { PriceHistoryEntryDto } from '@shared/models';
import { describe, expect, it, vi } from 'vitest';
import { PriceHistoryDrawerComponent } from './price-history-drawer';

describe('PriceHistoryDrawerComponent', () => {
  function setup(history: PriceHistoryEntryDto[] = [], isOpen = true) {
    const fixture = TestBed.createComponent(PriceHistoryDrawerComponent);
    fixture.componentRef.setInput('isOpen', isOpen);
    fixture.componentRef.setInput('priceHistory', history);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.detectChanges();
    return { fixture, closed, el: fixture.nativeElement as HTMLElement };
  }

  const entry = (over: Partial<PriceHistoryEntryDto> = {}): PriceHistoryEntryDto => ({
    id: '1',
    oldPrice: 10,
    newPrice: 1234.5,
    updatedAt: '2026-01-15T10:30:00',
    updatedBy: 'u1',
    updatedByName: 'Jane',
    ...over,
  });

  it('shows the title and subtitle', () => {
    const { el } = setup();
    expect(el.querySelector('h2')!.textContent).toBe('Price History');
    expect(el.textContent).toContain('Track price changes over time');
  });

  it('shows the empty state when there is no history', () => {
    const { el } = setup([]);
    expect(el.textContent).toContain('No price changes recorded yet.');
  });

  it('renders entries with formatted prices and user', () => {
    const { el } = setup([entry()]);
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('1,234.50');
    expect(text).toContain('10.00');
    expect(text).toContain('Jane');
    expect(text).toContain('15 Jan 2026');
    expect(el.querySelector('.line-through')).toBeTruthy();
    expect(el.textContent).not.toContain('No price changes recorded yet.');
  });

  it('shows System when the user name is missing', () => {
    const { el } = setup([entry({ updatedByName: null })]);
    expect(el.textContent).toContain('System');
  });

  it('omits the old price when null or undefined', () => {
    expect(setup([entry({ oldPrice: null })]).el.querySelector('.line-through')).toBeNull();
    const second = setup([entry({ oldPrice: undefined })]);
    expect(second.el.querySelector('.line-through')).toBeNull();
  });

  it('keeps a zero old price visible', () => {
    const { el } = setup([entry({ oldPrice: 0 })]);
    expect(el.querySelector('.line-through')!.textContent).toContain('0.00');
  });

  it('emits closed when the drawer closes', () => {
    const { el, closed } = setup();
    (el.querySelector('[aria-label="Close price history"]') as HTMLButtonElement).click();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
