import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConnectivityService } from '@core/services';
import { describe, expect, it } from 'vitest';
import { OfflineBannerComponent } from './offline-banner';

describe('OfflineBannerComponent', () => {
  function setup(online: boolean, reconnected = false) {
    const isOnline = signal(online);
    const showReconnected = signal(reconnected);
    TestBed.configureTestingModule({
      providers: [{ provide: ConnectivityService, useValue: { isOnline, showReconnected } }],
    });
    const fixture = TestBed.createComponent(OfflineBannerComponent);
    fixture.detectChanges();
    return { fixture, isOnline, showReconnected, el: fixture.nativeElement as HTMLElement };
  }

  it('renders nothing when online and not just reconnected', () => {
    const { el } = setup(true);
    expect(el.textContent!.trim()).toBe('');
  });

  it('shows the offline banner when offline', () => {
    const { el } = setup(false);
    expect(el.textContent).toContain("You're offline");
    expect(el.querySelector('.bg-amber-500')).toBeTruthy();
  });

  it('shows the offline banner even if reconnected flag is set', () => {
    const { el } = setup(false, true);
    expect(el.textContent).toContain("You're offline");
    expect(el.textContent).not.toContain('back online');
  });

  it('shows the reconnected banner when online and flagged', () => {
    const { el } = setup(true, true);
    expect(el.textContent).toContain("You're back online");
    expect(el.querySelector('.bg-emerald-500')).toBeTruthy();
  });

  it('reacts to connectivity changes', () => {
    const { fixture, isOnline, showReconnected, el } = setup(true);
    isOnline.set(false);
    fixture.detectChanges();
    expect(el.textContent).toContain("You're offline");

    isOnline.set(true);
    showReconnected.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain("You're back online");

    showReconnected.set(false);
    fixture.detectChanges();
    expect(el.textContent!.trim()).toBe('');
  });
});
