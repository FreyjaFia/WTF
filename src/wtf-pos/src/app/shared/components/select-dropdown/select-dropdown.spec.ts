import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SelectDropdownComponent, SelectDropdownOption } from './select-dropdown';

const options: SelectDropdownOption[] = [
  { id: 'a', label: 'Cup' },
  { id: 'b', label: 'Lid' },
  { id: 'c', label: 'Milk' },
];

@Component({
  imports: [SelectDropdownComponent],
  template: `<app-select-dropdown
    testId="pick"
    placeholder="Choose..."
    [emptyLabel]="emptyLabel()"
    [options]="options"
    [selectedId]="selected()"
    (selectedIdChange)="picked = $event"
  />`,
})
class HostComponent {
  public readonly emptyLabel = signal<string | null>(null);
  public readonly selected = signal<string | null>(null);
  public readonly options = options;
  public picked: string | null | undefined;
}

describe('SelectDropdownComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const trigger = () => el.querySelector('[data-testid="pick"]') as HTMLButtonElement;
    const open = () => {
      trigger().click();
      fixture.detectChanges();
    };
    const optionEls = () => [...el.querySelectorAll('[data-testid="pick-option"]')];
    return { fixture, el, trigger, open, optionEls };
  }

  it('shows the placeholder and opens a list of options', () => {
    const { trigger, open, optionEls } = setup();

    expect(trigger().textContent).toContain('Choose...');
    expect(optionEls().length).toBe(0);
    open();
    expect(optionEls().map((o) => o.textContent?.trim())).toEqual(['Cup', 'Lid', 'Milk']);
  });

  it('emits the chosen id and closes', () => {
    const { fixture, open, optionEls } = setup();
    open();
    (optionEls()[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picked).toBe('b');
    expect(optionEls().length).toBe(0);
  });

  it('narrows the options with the search box', () => {
    const { fixture, el, open, optionEls } = setup();
    open();
    const input = el.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'mi';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(optionEls().map((o) => o.textContent?.trim())).toEqual(['Milk']);
  });

  it('offers a first row to clear the choice when there is an empty label', () => {
    const { fixture, open, optionEls, trigger } = setup();
    fixture.componentInstance.emptyLabel.set('No size');
    fixture.componentInstance.selected.set('a');
    fixture.detectChanges();

    expect(trigger().textContent).toContain('Cup');
    open();
    expect(optionEls()[0].textContent?.trim()).toBe('No size');
    (optionEls()[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toBeNull();
  });

  it('closes on an outside click', () => {
    const { fixture, open, optionEls } = setup();
    open();
    document.body.click();
    fixture.detectChanges();

    expect(optionEls().length).toBe(0);
  });
});
