import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertComponent, AlertType } from './alert';

describe('AlertComponent', () => {
  let fixture: ComponentFixture<AlertComponent>;

  function render(
    type: AlertType = 'info',
    message = 'Hello',
    extra: Record<string, unknown> = {},
  ): void {
    fixture = TestBed.createComponent(AlertComponent);
    fixture.componentRef.setInput('type', type);
    fixture.componentRef.setInput('message', message);
    Object.entries(extra).forEach(([k, v]) => fixture.componentRef.setInput(k, v));
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const toast = () => el().querySelector('[role="alert"]') as HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the message with role alert', () => {
    render('info', 'Saved!');
    expect(toast()).toBeTruthy();
    expect(el().textContent).toContain('Saved!');
  });

  it.each([
    ['success', 'border-l-emerald-600', 'bg-emerald-50'],
    ['error', 'border-l-red-600', 'bg-red-50'],
    ['warning', 'border-l-amber-500', 'bg-amber-50'],
    ['info', 'border-l-blue-600', 'bg-blue-50'],
  ] as [AlertType, string, string][])('applies %s styling', (type, border, bg) => {
    render(type);
    expect(toast().className).toContain(border);
    expect(toast().className).toContain(bg);
  });

  it('does not render an action button without a label', () => {
    render();
    expect(el().querySelectorAll('button').length).toBe(1);
  });

  it('runs the action and dismisses when the action button is clicked', () => {
    const action = vi.fn();
    render('info', 'Msg', { actionLabel: 'Undo', action });
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);

    const buttons = el().querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain('Undo');
    buttons[0].click();
    fixture.detectChanges();

    expect(action).toHaveBeenCalledTimes(1);
    expect(toast().classList).toContain('toast-exit');
    expect(dismissed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('dismisses with exit animation when the close button is clicked', () => {
    render();
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);

    (el().querySelector('[aria-label="Close alert"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(toast().classList).toContain('toast-exit');
    vi.advanceTimersByTime(250);
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after 4 seconds', () => {
    render();
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);

    vi.advanceTimersByTime(3999);
    expect(dismissed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(250);
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('does not auto-dismiss after being destroyed', () => {
    render();
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);
    fixture.destroy();
    vi.advanceTimersByTime(10000);
    expect(dismissed).not.toHaveBeenCalled();
  });
});
