import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItemDto } from '@shared/models';
import { describe, expect, it, vi } from 'vitest';
import { StockAdjustDialogComponent } from './stock-adjust-dialog';

const item = { id: 'i1', name: 'Oat Milk', unitName: 'ml', currentQuantity: 10 } as ItemDto;

describe('StockAdjustDialogComponent', () => {
  let fixture: ComponentFixture<StockAdjustDialogComponent>;

  function setup() {
    fixture = TestBed.createComponent(StockAdjustDialogComponent);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    return { confirmed, cancelled };
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const quantity = () => el().querySelector('#adjust-quantity') as HTMLInputElement;
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

  function typeQuantity(value: string) {
    quantity().value = value;
    quantity().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function pick(selector: string, value: string) {
    const control = el().querySelector(selector) as HTMLSelectElement | HTMLTextAreaElement;
    control.value = value;
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
    fixture.detectChanges();
  }

  it('names the item and its balance', () => {
    setup();
    expect(el().textContent).toContain('Oat Milk');
    expect(el().textContent).toContain('Balance now: 10 ml');
  });

  it('shows the difference between the count and the balance as the user types', () => {
    setup();
    typeQuantity('7');
    expect(el().querySelector('[data-testid="difference"]')?.textContent).toContain('Difference: -3 ml');
  });

  it('asks for a quantity first', () => {
    const { confirmed } = setup();
    button('Save Adjustment').click();
    fixture.detectChanges();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Enter the quantity you counted.');
  });

  it('refuses a count equal to the balance', () => {
    const { confirmed } = setup();
    typeQuantity('10');
    button('Save Adjustment').click();
    fixture.detectChanges();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('nothing to adjust');
  });

  it('sends the counted quantity with the balance the screen showed', () => {
    const { confirmed } = setup();
    typeQuantity('7');
    button('Save Adjustment').click();

    expect(confirmed).toHaveBeenCalledWith({
      itemId: 'i1',
      countedQuantity: 7,
      expectedQuantity: 10,
      quantityChange: null,
      reason: 'Count correction',
      notes: null,
    });
  });

  it('sends a plus/minus change instead when chosen', () => {
    const { confirmed } = setup();
    (el().querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).dispatchEvent(new Event('change'));
    fixture.detectChanges();
    typeQuantity('-4');
    pick('#adjust-reason', 'Lost');
    button('Save Adjustment').click();

    expect(confirmed).toHaveBeenCalledWith({
      itemId: 'i1',
      countedQuantity: null,
      expectedQuantity: null,
      quantityChange: -4,
      reason: 'Lost',
      notes: null,
    });
  });

  it('needs a note when the reason is Other', () => {
    const { confirmed } = setup();
    typeQuantity('7');
    pick('#adjust-reason', 'Other');
    button('Save Adjustment').click();
    fixture.detectChanges();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('A note is required when the reason is Other.');

    pick('#adjust-notes', ' spilled ');
    button('Save Adjustment').click();
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Other', notes: 'spilled' }));
  });

  it('cancels', () => {
    const { cancelled } = setup();
    button('Cancel').click();
    expect(cancelled).toHaveBeenCalled();
  });
});
