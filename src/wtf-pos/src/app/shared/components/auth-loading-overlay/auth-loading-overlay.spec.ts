import { TestBed } from '@angular/core/testing';
import { AuthLoadingService } from '@core/services';
import { describe, expect, it } from 'vitest';
import { AuthLoadingOverlayComponent } from './auth-loading-overlay';

describe('AuthLoadingOverlayComponent', () => {
  function setup() {
    const service = TestBed.inject(AuthLoadingService);
    const fixture = TestBed.createComponent(AuthLoadingOverlayComponent);
    fixture.detectChanges();
    return { service, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('is hidden when nothing is loading', () => {
    const { el } = setup();
    expect(el.querySelector('[aria-live]')).toBeNull();
  });

  it('shows the session message while checking the session', () => {
    const { service, fixture, el } = setup();
    service.setCheckingSession(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Checking session...');
  });

  it('shows the profile message while loading the profile', () => {
    const { service, fixture, el } = setup();
    service.setLoadingProfile(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Loading profile...');
  });

  it('prefers the session message when both flags are set', () => {
    const { service, fixture, el } = setup();
    service.setCheckingSession(true);
    service.setLoadingProfile(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Checking session...');
    expect(el.textContent).not.toContain('Loading profile...');
  });

  it('hides again once loading finishes', () => {
    const { service, fixture, el } = setup();
    service.setLoadingProfile(true);
    fixture.detectChanges();
    service.setLoadingProfile(false);
    fixture.detectChanges();
    expect(el.querySelector('[aria-live]')).toBeNull();
  });
});
