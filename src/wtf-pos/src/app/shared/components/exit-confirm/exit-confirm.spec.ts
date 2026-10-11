import { TestBed } from '@angular/core/testing';
import { ModalStackService } from '@core/services';
import { describe, expect, it, vi } from 'vitest';
import { ExitConfirmComponent } from './exit-confirm';

describe('ExitConfirmComponent', () => {
  function setup() {
    const stack = TestBed.inject(ModalStackService);
    const fixture = TestBed.createComponent(ExitConfirmComponent);
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent!.includes(label))!;
    return { stack, fixture, el, confirmed, cancelled, button };
  }

  it('is hidden until opened', () => {
    const { el, stack } = setup();
    expect(el.querySelector('app-confirm-dialog')).toBeNull();
    expect(stack.hasOpen()).toBe(false);
  });

  it('opens the dialog and registers on the modal stack', () => {
    const { fixture, el, stack } = setup();
    fixture.componentInstance.open();
    fixture.detectChanges();
    expect(el.textContent).toContain('Close App?');
    expect(el.textContent).toContain('Are you sure you want to close the app?');
    expect(stack.hasOpen()).toBe(true);
  });

  it('emits confirmed and closes on confirm', () => {
    const { fixture, el, stack, confirmed, cancelled, button } = setup();
    fixture.componentInstance.open();
    fixture.detectChanges();
    button('Close App').click();
    fixture.detectChanges();

    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    expect(el.querySelector('app-confirm-dialog')).toBeNull();
    expect(stack.hasOpen()).toBe(false);
  });

  it('emits cancelled and closes on cancel', () => {
    const { fixture, el, stack, confirmed, cancelled, button } = setup();
    fixture.componentInstance.open();
    fixture.detectChanges();
    button('Cancel').click();
    fixture.detectChanges();

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(confirmed).not.toHaveBeenCalled();
    expect(el.querySelector('app-confirm-dialog')).toBeNull();
    expect(stack.hasOpen()).toBe(false);
  });

  it('cancels when the modal stack pops (back button)', () => {
    const { fixture, el, stack, cancelled } = setup();
    fixture.componentInstance.open();
    fixture.detectChanges();

    expect(stack.pop()).toBe(true);
    fixture.detectChanges();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(el.querySelector('app-confirm-dialog')).toBeNull();
  });

  it('close() is safe when never opened', () => {
    const { fixture, stack } = setup();
    fixture.componentInstance.close();
    expect(stack.hasOpen()).toBe(false);
  });
});
