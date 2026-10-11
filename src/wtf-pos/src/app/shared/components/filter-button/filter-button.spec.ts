import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { FilterButtonComponent } from './filter-button';

describe('FilterButtonComponent', () => {
  let fixture: ComponentFixture<FilterButtonComponent>;

  function setup(count?: number) {
    fixture = TestBed.createComponent(FilterButtonComponent);
    if (count !== undefined) {
      fixture.componentRef.setInput('count', count);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const button = () => el().querySelector('button') as HTMLButtonElement;
  const badge = () => el().querySelector('[data-filter-count]');

  it('says Filters, with no number when nothing is applied', () => {
    setup();
    expect(button().textContent).toContain('Filters');
    expect(badge()).toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Filters');
  });

  it('shows how many filters are applied', () => {
    setup(3);
    expect(badge()!.textContent!.trim()).toBe('3');
    expect(button().getAttribute('aria-label')).toBe('Filters, 3 applied');
  });

  it('follows the count as it changes', () => {
    setup(2);
    fixture.componentRef.setInput('count', 0);
    fixture.detectChanges();
    expect(badge()).toBeNull();
  });

  it('tells the page it was pressed', () => {
    setup();
    const pressed = vi.fn();
    fixture.componentInstance.pressed.subscribe(pressed);
    button().click();
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});
