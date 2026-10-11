import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOLD_MS, HoldButtonComponent } from './hold-button';

describe('HoldButtonComponent', () => {
  let fixture: ComponentFixture<HoldButtonComponent>;
  let held: ReturnType<typeof vi.fn<() => void>>;

  function setup(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(HoldButtonComponent);
    fixture.componentRef.setInput('label', 'Place Order');
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    held = vi.fn<() => void>();
    fixture.componentInstance.held.subscribe(held);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const button = () => el().querySelector('button') as HTMLButtonElement;
  const fill = () => el().querySelector('[data-hold-progress]') as HTMLElement;

  const pressDown = () =>
    button().dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
  const pressUp = () => button().dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  const keyDown = (key: string, repeat = false) =>
    button().dispatchEvent(
      new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }),
    );
  const keyUp = (key: string) =>
    button().dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows its label and is a plain button in the form flow', () => {
    setup();
    expect(button().textContent).toContain('Place Order');
    expect(button().getAttribute('type')).toBe('button');
    expect(button().getAttribute('aria-label')).toBe('Place Order. Press and hold to confirm');
  });

  it('does nothing on a quick tap', () => {
    setup();
    pressDown();
    vi.advanceTimersByTime(150);
    pressUp();
    button().click();
    vi.advanceTimersByTime(2000);

    expect(held).not.toHaveBeenCalled();
  });

  it('fires once after the button has been held long enough', () => {
    setup();
    pressDown();
    vi.advanceTimersByTime(DEFAULT_HOLD_MS + 100);

    expect(held).toHaveBeenCalledTimes(1);
    pressUp();
    vi.advanceTimersByTime(3000);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it('does not fire a moment before the time is up', () => {
    setup();
    pressDown();
    vi.advanceTimersByTime(DEFAULT_HOLD_MS - 100);

    expect(held).not.toHaveBeenCalled();
  });

  it('grows the fill while held and empties it when let go', () => {
    setup();
    pressDown();
    vi.advanceTimersByTime(500);
    fixture.detectChanges();
    const width = parseFloat(fill().style.width);
    expect(width).toBeGreaterThan(30);
    expect(width).toBeLessThan(70);

    pressUp();
    fixture.detectChanges();
    expect(parseFloat(fill().style.width)).toBe(0);
  });

  it('cancels when the pointer leaves or the touch is cancelled', () => {
    setup();
    pressDown();
    vi.advanceTimersByTime(600);
    button().dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(2000);
    expect(held).not.toHaveBeenCalled();

    pressDown();
    vi.advanceTimersByTime(600);
    button().dispatchEvent(new PointerEvent('pointercancel'));
    vi.advanceTimersByTime(2000);
    expect(held).not.toHaveBeenCalled();
  });

  it('ignores a right click', () => {
    setup();
    button().dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
    vi.advanceTimersByTime(2000);

    expect(held).not.toHaveBeenCalled();
  });

  it('works from the keyboard by holding Enter or Space', () => {
    setup();
    keyDown('Enter');
    keyDown('Enter', true);
    vi.advanceTimersByTime(DEFAULT_HOLD_MS + 100);
    expect(held).toHaveBeenCalledTimes(1);

    keyUp('Enter');
    keyDown(' ');
    vi.advanceTimersByTime(DEFAULT_HOLD_MS + 100);
    expect(held).toHaveBeenCalledTimes(2);
  });

  it('cancels when the key is let go early or the button loses focus', () => {
    setup();
    keyDown('Enter');
    vi.advanceTimersByTime(500);
    keyUp('Enter');
    vi.advanceTimersByTime(2000);
    expect(held).not.toHaveBeenCalled();

    keyDown(' ');
    vi.advanceTimersByTime(500);
    button().dispatchEvent(new FocusEvent('blur'));
    vi.advanceTimersByTime(2000);
    expect(held).not.toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    setup();
    keyDown('a');
    keyDown('Tab');
    vi.advanceTimersByTime(2000);

    expect(held).not.toHaveBeenCalled();
  });

  it('can be held again after it fired', () => {
    setup();
    pressDown();
    vi.advanceTimersByTime(DEFAULT_HOLD_MS + 100);
    pressUp();
    pressDown();
    vi.advanceTimersByTime(DEFAULT_HOLD_MS + 100);

    expect(held).toHaveBeenCalledTimes(2);
  });

  it('uses the hold time it is given', () => {
    setup({ durationMs: 300 });
    pressDown();
    vi.advanceTimersByTime(350);

    expect(held).toHaveBeenCalledTimes(1);
  });

  it('reminds how it works after an early release, then hides the reminder', () => {
    setup({ hint: 'Hold to place your order' });
    pressDown();
    vi.advanceTimersByTime(200);
    pressUp();
    fixture.detectChanges();

    expect(el().querySelector('[role="status"]')!.textContent).toContain(
      'Hold to place your order',
    );
    vi.advanceTimersByTime(2100);
    fixture.detectChanges();
    expect(el().querySelector('[role="status"]')).toBeNull();
  });

  it('tells the page when it is let go too early, but not after a full hold', () => {
    setup();
    const released = vi.fn<() => void>();
    fixture.componentInstance.released.subscribe(released);

    pressDown();
    vi.advanceTimersByTime(300);
    pressUp();
    expect(released).toHaveBeenCalledTimes(1);

    pressDown();
    vi.advanceTimersByTime(DEFAULT_HOLD_MS + 100);
    pressUp();
    expect(released).toHaveBeenCalledTimes(1);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it('does not report a release when it was never pressed', () => {
    setup();
    const released = vi.fn<() => void>();
    fixture.componentInstance.released.subscribe(released);

    pressUp();
    button().dispatchEvent(new PointerEvent('pointerleave'));

    expect(released).not.toHaveBeenCalled();
  });

  it('can leave the reminder to the page', () => {
    setup({ reminder: false });
    pressDown();
    vi.advanceTimersByTime(200);
    pressUp();
    fixture.detectChanges();

    expect(el().querySelector('[role="status"]')).toBeNull();
  });

  it('shows no reminder after a successful hold', () => {
    setup();
    pressDown();
    vi.advanceTimersByTime(DEFAULT_HOLD_MS + 100);
    fixture.detectChanges();

    expect(el().querySelector('[role="status"]')).toBeNull();
  });

  it('does nothing while disabled', () => {
    setup({ disabled: true });
    expect(button().disabled).toBe(true);
    pressDown();
    keyDown('Enter');
    vi.advanceTimersByTime(2000);

    expect(held).not.toHaveBeenCalled();
  });

  it('shows the busy label with a spinner and cannot be held while busy', () => {
    setup({ busy: true, busyLabel: 'Placing order...' });

    expect(button().textContent).toContain('Placing order...');
    expect(el().querySelector('.loading-spinner')).not.toBeNull();
    expect(button().disabled).toBe(true);
    pressDown();
    vi.advanceTimersByTime(2000);
    expect(held).not.toHaveBeenCalled();
  });

  it('stops its timer when it is destroyed mid-hold', () => {
    setup();
    pressDown();
    vi.advanceTimersByTime(500);
    fixture.destroy();
    vi.advanceTimersByTime(2000);

    expect(held).not.toHaveBeenCalled();
  });

  it('stops a long press on a phone from opening the context menu', () => {
    setup();
    const event = new Event('contextmenu', { cancelable: true });
    button().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('takes the style it is given and fills the width of its place', () => {
    setup({ buttonClass: 'app-btn app-btn-primary app-btn-md' });
    expect(button().className).toContain('app-btn-primary');
    expect(button().className).toContain('w-full');
    expect(button().className).toContain('select-none');
  });
});
