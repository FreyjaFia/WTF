import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PlatformService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImpersonationBarComponent } from './impersonation-bar';

afterEach(() => vi.useRealTimers());

function render(info: unknown) {
  const platform = { getImpersonation: vi.fn().mockReturnValue(info), endImpersonation: vi.fn() };
  const router = { navigateByUrl: vi.fn() };
  TestBed.configureTestingModule({
    imports: [ImpersonationBarComponent],
    providers: [
      { provide: PlatformService, useValue: platform },
      { provide: Router, useValue: router },
    ],
  });
  const fixture = TestBed.createComponent(ImpersonationBarComponent);
  fixture.detectChanges();

  return { fixture, platform, router, text: () => (fixture.nativeElement as HTMLElement).textContent ?? '' };
}

describe('ImpersonationBarComponent', () => {
  it('shows nothing in a normal session', () => {
    expect(render(null).text().trim()).toBe('');
  });

  it('says who you are signed in as, and whether changes are allowed', () => {
    const { text } = render({ expiresAt: 'x', username: 'owner', tenantName: 'Moon', readOnly: true });

    expect(text()).toContain('owner');
    expect(text()).toContain('Moon');
    expect(text()).toContain('read-only');
  });

  it('leaving ends the session and returns to the platform', () => {
    const { fixture, platform, router } = render({ expiresAt: 'x', username: 'o', tenantName: 'M', readOnly: false });

    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();

    expect(platform.endImpersonation).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.PlatformRoot, { replaceUrl: true });
  });

  it('goes to the shop login when the session runs out', () => {
    vi.useFakeTimers();
    const { platform, router } = render({ expiresAt: 'x', username: 'o', tenantName: 'M', readOnly: true });
    platform.getImpersonation.mockReturnValue(null);

    vi.advanceTimersByTime(15000);

    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Login, { replaceUrl: true });
  });
});
