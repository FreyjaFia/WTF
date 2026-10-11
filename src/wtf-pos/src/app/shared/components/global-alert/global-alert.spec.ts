import { TestBed } from '@angular/core/testing';
import { AlertService } from '@core/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalAlertComponent } from './global-alert';

describe('GlobalAlertComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const service = TestBed.inject(AlertService);
    const fixture = TestBed.createComponent(GlobalAlertComponent);
    fixture.detectChanges();
    TestBed.tick();
    return { service, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders nothing when no alert is visible', () => {
    const { el } = setup();
    expect(el.querySelector('app-alert')).toBeNull();
  });

  it('shows the alert with its message and type', () => {
    const { service, fixture, el } = setup();
    service.error('Boom');
    fixture.detectChanges();
    expect(el.querySelector('app-alert')).toBeTruthy();
    expect(el.textContent).toContain('Boom');
    expect(el.querySelector('.border-l-red-600')).toBeTruthy();
  });

  it('renders the action button and invokes the action', () => {
    const { service, fixture, el } = setup();
    const action = vi.fn();
    service.successWithAction('Done', 'Undo', action);
    fixture.detectChanges();

    const button = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Undo'));
    expect(button).toBeTruthy();
    button!.click();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('dismisses the service alert after the alert animation finishes', () => {
    const { service, fixture, el } = setup();
    service.info('Hi');
    fixture.detectChanges();

    (el.querySelector('[aria-label="Close alert"]') as HTMLButtonElement).click();
    vi.advanceTimersByTime(250);
    fixture.detectChanges();

    expect(service.alert().visible).toBe(false);
    expect(el.querySelector('app-alert')).toBeNull();
  });
});
