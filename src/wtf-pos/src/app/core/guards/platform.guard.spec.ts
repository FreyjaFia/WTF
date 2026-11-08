import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { PlatformService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { describe, expect, it, vi } from 'vitest';
import { platformGuard } from './platform.guard';

function run(signedIn: boolean) {
  const platform = { isSignedIn: vi.fn().mockReturnValue(signedIn), logout: vi.fn() };
  const router = { navigateByUrl: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformService, useValue: platform },
      { provide: Router, useValue: router },
    ],
  });
  const result = TestBed.runInInjectionContext(() => platformGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));

  return { result, platform, router };
}

describe('platformGuard', () => {
  it('lets a signed-in platform admin in', () => {
    const { result, router } = run(true);

    expect(result).toBe(true);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('sends everyone else to the platform login, not the shop login', () => {
    const { result, platform, router } = run(false);

    expect(result).toBe(false);
    expect(platform.logout).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.PlatformLogin, { replaceUrl: true });
  });
});
