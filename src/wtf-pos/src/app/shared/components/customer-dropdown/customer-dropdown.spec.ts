import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CustomerDropdownComponent, CustomerDropdownOption } from './customer-dropdown';

const OPTIONS: CustomerDropdownOption[] = [
  { id: '3', label: 'Zed' },
  { id: '1', label: 'alice' },
  { id: '2', label: 'Bob Smith' },
];

interface Internals {
  toggle(): void;
  searchTerm(): string;
  onSearchTermChange(v: string): void;
}

function setup(inputs: Record<string, unknown> = {}) {
  const fixture = TestBed.createComponent(CustomerDropdownComponent);
  fixture.componentRef.setInput('options', OPTIONS);
  for (const [k, v] of Object.entries(inputs)) {
    fixture.componentRef.setInput(k, v);
  }
  fixture.detectChanges();
  const selected = vi.fn();
  fixture.componentInstance.selectedIdChange.subscribe(selected);
  const root = fixture.nativeElement as HTMLElement;
  const toggleBtn = () => root.querySelector('button') as HTMLButtonElement;
  const optionButtons = () =>
    Array.from(root.querySelectorAll('.max-h-48 button')) as HTMLButtonElement[];
  const internals = fixture.componentInstance as unknown as Internals;
  return { fixture, root, selected, toggleBtn, optionButtons, internals };
}

describe('CustomerDropdownComponent', () => {
  it('shows the walk-in label when nothing is selected', () => {
    const { toggleBtn } = setup();
    expect(toggleBtn().textContent).toContain('Walk-in customer');
  });

  it('shows the selected customer label, falling back to walk-in for unknown ids', () => {
    expect(setup({ selectedId: '2' }).toggleBtn().textContent).toContain('Bob Smith');
    expect(setup({ selectedId: 'nope' }).toggleBtn().textContent).toContain('Walk-in customer');
  });

  it('opens on click and lists walk-in plus sorted options', () => {
    const { fixture, toggleBtn, optionButtons } = setup();
    expect(optionButtons()).toHaveLength(0);
    toggleBtn().click();
    fixture.detectChanges();
    const texts = optionButtons().map((b) => b.textContent?.trim());
    expect(texts).toEqual(['Walk-in customer', 'alice', 'Bob Smith', 'Zed']);
  });

  it('does not open when disabled', () => {
    const { fixture, toggleBtn, optionButtons, internals } = setup({ disabled: true });
    expect(toggleBtn().disabled).toBe(true);
    internals.toggle();
    fixture.detectChanges();
    expect(optionButtons()).toHaveLength(0);
  });

  it('emits the option id and closes when an option is picked', () => {
    const { fixture, toggleBtn, optionButtons, selected } = setup();
    toggleBtn().click();
    fixture.detectChanges();
    optionButtons()[2].click();
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('2');
    expect(optionButtons()).toHaveLength(0);
  });

  it('emits null for walk-in', () => {
    const { fixture, toggleBtn, optionButtons, selected } = setup({ selectedId: '1' });
    toggleBtn().click();
    fixture.detectChanges();
    optionButtons()[0].click();
    expect(selected).toHaveBeenCalledWith(null);
  });

  it('filters case-insensitively by search term and shows empty state', () => {
    const { fixture, toggleBtn, optionButtons, root, internals } = setup();
    toggleBtn().click();
    fixture.detectChanges();
    internals.onSearchTermChange('  SMITH ');
    fixture.detectChanges();
    expect(optionButtons().map((b) => b.textContent?.trim())).toEqual([
      'Walk-in customer',
      'Bob Smith',
    ]);
    internals.onSearchTermChange('qqq');
    fixture.detectChanges();
    expect(root.textContent).toContain('No customers found');
  });

  it('clears the search term when toggled closed', () => {
    const { toggleBtn, internals } = setup();
    toggleBtn().click();
    internals.onSearchTermChange('x');
    toggleBtn().click();
    expect(internals.searchTerm()).toBe('');
  });

  it('closes on outside click and on Escape, but not on inside click', () => {
    const { fixture, root, toggleBtn, optionButtons } = setup();
    document.body.appendChild(root);
    toggleBtn().click();
    fixture.detectChanges();
    root.querySelector('.max-h-48')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(optionButtons().length).toBeGreaterThan(0);

    document.body.click();
    fixture.detectChanges();
    expect(optionButtons()).toHaveLength(0);

    toggleBtn().click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(optionButtons()).toHaveLength(0);
    root.remove();
  });
});
