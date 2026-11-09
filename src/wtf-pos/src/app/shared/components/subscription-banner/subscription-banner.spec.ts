import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, SubscriptionService } from '@core/services';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionBannerComponent } from './subscription-banner';

describe('SubscriptionBannerComponent', () => {
  function setup(warning: string, access: string, canRenew = true, daysLeft = 3) {
    const refresh = vi.fn();
    const logout = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SubscriptionService,
          useValue: {
            warning: signal(warning),
            access: signal(access),
            daysLeft: signal(daysLeft),
            periodEnd: signal(new Date('2026-12-01T00:00:00Z')),
            refresh,
          },
        },
        { provide: AuthService, useValue: { can: () => canRenew, logout } },
      ],
    });
    const fixture = TestBed.createComponent(SubscriptionBannerComponent);
    fixture.detectChanges();
    return { fixture, refresh, logout, el: fixture.nativeElement as HTMLElement };
  }

  it('shows nothing when the subscription is fine', () => {
    const { el } = setup('none', 'ok');
    expect(el.textContent!.trim()).toBe('');
  });

  it('warns with the days left and links the owner to the details', () => {
    const { el } = setup('lastDays', 'ok');
    expect(el.textContent).toContain('ends in 3 days');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/management/shop/plan');
  });

  it('tells other roles to ask the owner', () => {
    const { el } = setup('soon', 'ok', false, 6);
    expect(el.textContent).toContain('ask the owner');
    expect(el.querySelector('a')).toBeNull();
  });

  it('locks the screen with check again and log out', () => {
    const { el, refresh, logout } = setup('locked', 'locked');
    expect(el.querySelector('[data-testid="subscription-lock"]')).toBeTruthy();
    const [check, out] = Array.from(el.querySelectorAll('button'));
    check.click();
    out.click();
    expect(refresh).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });

  it('asks for a connection when the lease is too old', () => {
    const { el } = setup('none', 'needsOnline');
    expect(el.textContent).toContain('Connect to the internet');
  });
});
