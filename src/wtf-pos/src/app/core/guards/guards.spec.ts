import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRole, AppRoles } from '@shared/constants/app-roles';
import { AppRoutes } from '@shared/constants/app-routes';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authGuard } from './auth.guard';
import { loginGuard } from './login.guard';
import { roleGuard } from './role.guard';
import { HasUnsavedChanges, unsavedChangesGuard } from './unsaved-changes.guard';

const state = {} as RouterStateSnapshot;

function routeWithRoles(roles?: AppRole[]): ActivatedRouteSnapshot {
  return { data: roles ? { roles } : {} } as unknown as ActivatedRouteSnapshot;
}

describe('route guards', () => {
  let auth: Record<string, ReturnType<typeof vi.fn>>;
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = {
      isTokenValid: vi.fn().mockReturnValue(false),
      getRefreshToken: vi.fn().mockReturnValue(null),
      refreshToken: vi.fn(),
      canReadManagement: vi.fn().mockReturnValue(false),
      canWriteOrders: vi.fn().mockReturnValue(false),
      canReadOrders: vi.fn().mockReturnValue(false),
      hasAnyRole: vi.fn().mockReturnValue(false),
    };
    router = { navigateByUrl: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    });
  });

  describe('authGuard', () => {
    const run = () =>
      TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, state));

    it('allows access with a valid token', () => {
      auth['isTokenValid'].mockReturnValue(true);

      expect(run()).toBe(true);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('redirects to login when there is no token and no refresh token', () => {
      expect(run()).toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Login, { replaceUrl: true });
    });

    it('refreshes an expired token and allows access', () => {
      auth['getRefreshToken'].mockReturnValue('refresh');
      auth['refreshToken'].mockReturnValue(of({}));
      const result = run() as Observable<boolean>;
      const emitted: boolean[] = [];

      result.subscribe((value) => emitted.push(value));

      expect(emitted).toEqual([true]);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('redirects to login when the refresh fails', () => {
      auth['getRefreshToken'].mockReturnValue('refresh');
      auth['refreshToken'].mockReturnValue(throwError(() => new Error('nope')));
      const emitted: boolean[] = [];

      (run() as Observable<boolean>).subscribe((value) => emitted.push(value));

      expect(emitted).toEqual([false]);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Login, { replaceUrl: true });
    });
  });

  describe('loginGuard', () => {
    const run = () => TestBed.runInInjectionContext(() => loginGuard({} as ActivatedRouteSnapshot, state));

    it('lets unauthenticated users see the login page', () => {
      expect(run()).toBe(true);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('sends management users to the dashboard', () => {
      auth['isTokenValid'].mockReturnValue(true);
      auth['canReadManagement'].mockReturnValue(true);

      expect(run()).toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Dashboard, { replaceUrl: true });
    });

    it('sends order writers to the order editor', () => {
      auth['isTokenValid'].mockReturnValue(true);
      auth['canWriteOrders'].mockReturnValue(true);

      expect(run()).toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrdersEditor, { replaceUrl: true });
    });

    it('sends everyone else to the orders list', () => {
      auth['isTokenValid'].mockReturnValue(true);

      expect(run()).toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrdersList, { replaceUrl: true });
    });
  });

  describe('roleGuard', () => {
    const run = (route: ActivatedRouteSnapshot) =>
      TestBed.runInInjectionContext(() => roleGuard(route, state));

    it('allows routes without required roles', () => {
      expect(run(routeWithRoles())).toBe(true);
      expect(run(routeWithRoles([]))).toBe(true);
      expect(auth['hasAnyRole']).not.toHaveBeenCalled();
    });

    it('allows users holding one of the required roles', () => {
      auth['hasAnyRole'].mockReturnValue(true);

      expect(run(routeWithRoles([AppRoles.Admin]))).toBe(true);
      expect(auth['hasAnyRole']).toHaveBeenCalledWith([AppRoles.Admin]);
    });

    it('falls back to the orders list for users who can read orders', () => {
      auth['canReadOrders'].mockReturnValue(true);

      expect(run(routeWithRoles([AppRoles.Admin]))).toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrdersList);
    });

    it('falls back to the dashboard for management readers without order access', () => {
      auth['canReadManagement'].mockReturnValue(true);

      expect(run(routeWithRoles([AppRoles.Admin]))).toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Dashboard);
    });

    it('falls back to login when the user has no read access at all', () => {
      expect(run(routeWithRoles([AppRoles.Admin]))).toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Login);
    });
  });

  describe('unsavedChangesGuard', () => {
    const run = (component: HasUnsavedChanges) =>
      unsavedChangesGuard(component, {} as ActivatedRouteSnapshot, state, state);

    it('defers to the component', () => {
      expect(run({ canDeactivate: () => false })).toBe(false);
      expect(run({ canDeactivate: () => true })).toBe(true);
    });

    it('supports async confirmation', async () => {
      await expect(run({ canDeactivate: () => Promise.resolve(false) })).resolves.toBe(false);
    });

    it('allows leaving when the component has no canDeactivate', () => {
      expect(run({} as HasUnsavedChanges)).toBe(true);
    });
  });
});
