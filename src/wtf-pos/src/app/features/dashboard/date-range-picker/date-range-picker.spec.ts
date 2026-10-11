import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateRangeSelection } from '@shared/models';
import { beforeEach, describe, expect, it } from 'vitest';
import { internalsOf } from '../../../testing/feature-spec-helpers';
import { DateRangePickerComponent } from './date-range-picker';

describe('DateRangePickerComponent', () => {
  let fixture: ComponentFixture<DateRangePickerComponent>;
  let emitted: DateRangeSelection[];
  let el: HTMLElement;

  const trigger = (): HTMLButtonElement => el.querySelector('button') as HTMLButtonElement;
  const label = (): string => trigger().textContent!.replace(/\s+/g, ' ').trim();
  const menuButtons = (): HTMLButtonElement[] =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('.absolute button'));
  const findMenuButton = (text: string): HTMLButtonElement =>
    menuButtons().find((b) => b.textContent!.trim().startsWith(text))!;
  const vm = () => internalsOf(fixture);

  beforeEach(() => {
    fixture = TestBed.createComponent(DateRangePickerComponent);
    emitted = [];
    fixture.componentInstance.rangeChanged.subscribe((r) => emitted.push(r));
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('defaults to Today with the live indicator and a closed menu', () => {
    expect(label()).toBe('Today');
    expect(vm()['isLive']()).toBe(true);
    expect(el.querySelector('.animate-pulse')).not.toBeNull();
    expect(menuButtons()).toHaveLength(0);
  });

  it('opens and closes the dropdown when the trigger is clicked', () => {
    trigger().click();
    fixture.detectChanges();
    expect(vm()['isOpen']()).toBe(true);
    expect(menuButtons().map((b) => b.textContent!.trim())).toEqual([
      'Today',
      'Yesterday',
      'Last 7 Days',
      'Last 30 Days',
      'Custom Range',
    ]);
    trigger().click();
    fixture.detectChanges();
    expect(vm()['isOpen']()).toBe(false);
  });

  it('closing the dropdown also hides the custom inputs', () => {
    trigger().click();
    vm()['openCustomRange']();
    expect(vm()['showCustomInputs']()).toBe(true);
    trigger().click();
    expect(vm()['showCustomInputs']()).toBe(false);
  });

  it('selecting a preset emits it, updates the label, hides the live dot and closes', () => {
    trigger().click();
    fixture.detectChanges();
    findMenuButton('Last 7 Days').click();
    fixture.detectChanges();
    expect(emitted).toEqual([{ preset: 'last7days' }]);
    expect(label()).toBe('Last 7 Days');
    expect(vm()['isLive']()).toBe(false);
    expect(el.querySelector('.animate-pulse')).toBeNull();
    expect(vm()['isOpen']()).toBe(false);
  });

  it.each([
    ['yesterday', 'Yesterday'],
    ['last30days', 'Last 30 Days'],
    ['today', 'Today'],
  ] as const)('selectPreset(%s) shows "%s"', (preset, text) => {
    vm()['selectPreset'](preset);
    fixture.detectChanges();
    expect(label()).toBe(text);
    expect(emitted).toEqual([{ preset }]);
  });

  describe('custom range', () => {
    function openCustom(): void {
      trigger().click();
      fixture.detectChanges();
      findMenuButton('Custom Range').click();
      fixture.detectChanges();
    }

    it('shows the date inputs with Apply disabled until both dates are set', () => {
      openCustom();
      const apply = findMenuButton('Apply');
      expect(el.querySelector('#date-range-start')).not.toBeNull();
      expect(el.querySelector('#date-range-end')).not.toBeNull();
      expect(apply.disabled).toBe(true);
      vm()['customStart'].set('2026-03-01');
      fixture.detectChanges();
      expect(apply.disabled).toBe(true);
      vm()['customEnd'].set('2026-03-05');
      fixture.detectChanges();
      expect(apply.disabled).toBe(false);
    });

    it('limits the date inputs to today', () => {
      openCustom();
      const start = el.querySelector('#date-range-start') as HTMLInputElement;
      expect(start.max).toBe(vm()['maxDate']);
      expect(vm()['maxDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('applies a custom range, emits both dates and formats the label', () => {
      openCustom();
      vm()['customStart'].set('2026-03-01');
      vm()['customEnd'].set('2026-03-05');
      vm()['applyCustomRange']();
      fixture.detectChanges();
      expect(emitted).toEqual([{ preset: 'custom', startDate: '2026-03-01', endDate: '2026-03-05' }]);
      expect(label()).toBe('Mar 1 - Mar 5');
      expect(vm()['isOpen']()).toBe(false);
      expect(vm()['showCustomInputs']()).toBe(false);
    });

    it('does nothing when applying with a missing date', () => {
      vm()['customStart'].set('2026-03-01');
      vm()['applyCustomRange']();
      expect(emitted).toEqual([]);
      expect(vm()['selectedPreset']()).toBe('today');
    });

    it('labels an incomplete custom selection as "Custom Range"', () => {
      vm()['selectedPreset'].set('custom');
      fixture.detectChanges();
      expect(label()).toBe('Custom Range');
    });
  });

  describe('outside clicks', () => {
    it('closes the dropdown and custom inputs when clicking outside', () => {
      trigger().click();
      vm()['openCustomRange']();
      fixture.detectChanges();
      document.body.click();
      expect(vm()['isOpen']()).toBe(false);
      expect(vm()['showCustomInputs']()).toBe(false);
    });

    it('stays open when clicking inside the component', () => {
      trigger().click();
      fixture.detectChanges();
      el.querySelector('.relative')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(vm()['isOpen']()).toBe(true);
    });
  });
});
