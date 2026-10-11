import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { StockInComponent } from './stock-in';

describe('StockInComponent', () => {
  it('renders the coming-soon placeholder', () => {
    const fixture = TestBed.createComponent(StockInComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1')?.textContent).toContain('Stock In');
    expect(el.textContent).toContain('Stock In coming soon');
  });
});
