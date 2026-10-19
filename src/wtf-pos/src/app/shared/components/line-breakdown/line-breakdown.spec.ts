import { ComponentFixture, TestBed } from '@angular/core/testing';
import { buildLineBreakdown, LineBreakdown } from '@shared/calculations';
import { beforeEach, describe, expect, it } from 'vitest';
import { LineBreakdownComponent, LineBreakdownVariant } from './line-breakdown';

describe('LineBreakdownComponent', () => {
  let fixture: ComponentFixture<LineBreakdownComponent>;

  const withPromo = (): LineBreakdown =>
    buildLineBreakdown({
      qty: 2,
      listUnitPrice: 150,
      addOns: [
        { addOnId: 'l', name: 'Large', price: 30 },
        { addOnId: 'n', name: 'No sugar', price: -5 },
      ],
      discount: { amount: 60, label: 'Promo -₱30.00' },
    });

  function render(breakdown: LineBreakdown, variant?: LineBreakdownVariant): HTMLElement {
    fixture = TestBed.createComponent(LineBreakdownComponent);
    fixture.componentRef.setInput('breakdown', breakdown);
    if (variant) {
      fixture.componentRef.setInput('variant', variant);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const textOf = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ');

  beforeEach(() => TestBed.configureTestingModule({ imports: [LineBreakdownComponent] }));

  it('renders nothing when there are no rows', () => {
    const el = render(buildLineBreakdown({ qty: 1, listUnitPrice: 100 }));
    expect(textOf(el).trim()).toBe('');
    expect(el.querySelector('div')).toBeNull();
  });

  describe.each<LineBreakdownVariant>(['card', 'receipt'])('%s variant', (variant) => {
    it('shows the base, the add-ons with plus or minus, and the promotion as a minus', () => {
      const text = textOf(render(withPromo(), variant));
      expect(text).toContain('Price');
      expect(text).toContain('₱150.00 each');
      expect(text).toContain('₱300.00');
      expect(text).toContain('+ ₱60.00');
      expect(text).toContain('− ₱10.00');
      expect(text).toContain('Discount');
      expect(text).toContain('₱30.00 each');
      expect(text).toContain('− ₱60.00');
    });

    it('gives the base row no sign', () => {
      const text = textOf(render(withPromo(), variant));
      expect(text).not.toContain('+ ₱300.00');
      expect(text).not.toContain('− ₱300.00');
    });
  });

  it('is the card variant by default, with a list for assistive tech', () => {
    const el = render(withPromo());
    expect(el.querySelector('[role="list"]')).not.toBeNull();
    expect(el.querySelectorAll('[role="listitem"]').length).toBe(4);
  });

  it('draws the receipt variant with inline styles only', () => {
    const el = render(withPromo(), 'receipt');
    expect(el.querySelector('[role="list"]')).toBeNull();
    expect(el.querySelector('[class]')).toBeNull();
  });
});
