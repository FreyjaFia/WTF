import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { FilterDropdownComponent, FilterOption } from './filter-dropdown';

const OPTIONS: FilterOption[] = [
  { id: 'a', label: 'Alpha', count: 3 },
  { id: 'b', label: 'Beta' },
  { id: 3, label: 'Gamma', count: 0 },
];

function setup(inputs: Record<string, unknown> = {}) {
  const fixture = TestBed.createComponent(FilterDropdownComponent);
  fixture.componentRef.setInput('options', OPTIONS);
  for (const [k, v] of Object.entries(inputs)) {
    fixture.componentRef.setInput(k, v);
  }
  fixture.detectChanges();
  const change = vi.fn();
  const reset = vi.fn();
  fixture.componentInstance.filterChange.subscribe(change);
  fixture.componentInstance.filterReset.subscribe(reset);
  const root = fixture.nativeElement as HTMLElement;
  return { fixture, root, change, reset };
}

describe('FilterDropdownComponent', () => {
  it('renders title, options and counts', () => {
    const { root } = setup({ title: 'Status' });
    expect(root.querySelector('summary')?.textContent).toContain('Status');
    expect(root.querySelectorAll('input')).toHaveLength(3);
    expect(root.textContent).toContain('Alpha');
    expect(root.textContent).toContain('Status Filters');
    const labels = Array.from(root.querySelectorAll('label'));
    expect(labels[0].textContent).toContain('3');
    expect(labels[2].textContent).toContain('0');
  });

  it('uses checkboxes in multi mode and radios in single mode', () => {
    expect(setup().root.querySelector('input')?.type).toBe('checkbox');
    expect(setup({ singleSelect: true }).root.querySelector('input')?.type).toBe('radio');
  });

  it('adds an option to the selection on change', () => {
    const { root, change } = setup({ selectedIds: ['a'] });
    root.querySelectorAll('input')[1].dispatchEvent(new Event('change'));
    expect(change).toHaveBeenCalledWith(['a', 'b']);
  });

  it('removes an already selected option', () => {
    const { root, change } = setup({ selectedIds: ['a', 'b'] });
    root.querySelectorAll('input')[0].dispatchEvent(new Event('change'));
    expect(change).toHaveBeenCalledWith(['b']);
  });

  it('emits only the clicked id in single select mode', () => {
    const { root, change } = setup({ singleSelect: true, selectedIds: ['a'] });
    root.querySelectorAll('input')[1].dispatchEvent(new Event('change'));
    expect(change).toHaveBeenCalledWith(['b']);
  });

  it('emits filterReset from the reset button', () => {
    const { root, reset } = setup();
    (root.querySelector('button') as HTMLButtonElement).click();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('is only active when showSelectedState is on and something is selected', () => {
    const inactive = setup({ selectedIds: ['a'] });
    expect(inactive.root.querySelector('summary')?.getAttribute('title')).toBeNull();

    const active = setup({ selectedIds: ['a'], showSelectedState: true });
    const summary = active.root.querySelector('summary') as HTMLElement;
    expect(summary.getAttribute('title')).toBe('Alpha');
    expect(summary.textContent).toContain('Selected: Alpha');

    const none = setup({ showSelectedState: true });
    expect(none.root.querySelector('summary')?.getAttribute('title')).toBeNull();
  });

  it('summarises multiple selections as a count', () => {
    const { root } = setup({ selectedIds: ['a', 'b', 3], showSelectedState: true });
    expect(root.querySelector('summary')?.getAttribute('title')).toBe('3 selected');
  });

  it('applies alignment classes', () => {
    expect(setup({ align: 'end' }).root.querySelector('details')?.classList).toContain(
      'dropdown-end',
    );
    expect(setup().root.querySelector('details')?.classList).toContain('dropdown-start');
  });

  it('closes on outside click but not inside click', () => {
    const { fixture, root } = setup();
    document.body.appendChild(root);
    const details = root.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    root.querySelector('ul')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(details.open).toBe(true);
    document.body.click();
    expect(details.open).toBe(false);
    root.remove();
    fixture.destroy();
  });

  it('stops click propagation on option labels', () => {
    const { root } = setup();
    const outer = vi.fn();
    root.addEventListener('click', outer);
    root.querySelector('label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(outer).not.toHaveBeenCalled();
  });
});
