import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { AuthService, PlanStore, SubscriptionService } from '@core/services';
import { SubscriptionDto } from '@shared/models/subscription.models';
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
  let router: { navigateByUrl: ReturnType<typeof vi.fn>; getCurrentNavigation: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    auth = {
      isTokenValid: vi.fn().mockReturnValue(false),
      getRefreshToken: vi.fn().mockReturnValue(null),
      refreshToken: vi.fn(),
      canReadManagement: vi.fn().mockReturnValue(false),
      canWriteOrders: vi.fn().mockReturnValue(false),
      canReadOrders: vi.fn().mockReturnValue(false),
      canReadKitchen: vi.fn().mockReturnValue(false),
      canReadStockMovements: vi.fn().mockReturnValue(false),
      canReadItems: vi.fn().mockReturnValue(false),
      canOpenManagementMenu: vi.fn().mockReturnValue(false),
      hasAnyRole: vi.fn().mockReturnValue(false),
    };
    router = { navigateByUrl: vi.fn().mockResolvedValue(true), getCurrentNavigation: vi.fn().mockReturnValue(null) };
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

  describe('authGuard when the refresh cannot reach the server', () => {
    it.each([0, 500, 503])('lets the person in when the refresh fails with %s', (status) => {
      auth['getRefreshToken'].mockReturnValue('refresh');
      auth['refreshToken'].mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
      const emitted: boolean[] = [];

      (TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, state)) as Observable<boolean>)
        .subscribe((value) => emitted.push(value));

      expect(emitted).toEqual([true]);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
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

    it('allows a route when the user holds any one of its anyPermission keys', () => {
      auth['canAny'] = vi.fn().mockReturnValue(true);
      const route = { data: { anyPermission: ['products.read', 'suppliers.read'] } } as unknown as ActivatedRouteSnapshot;

      expect(run(route)).toBe(true);
      expect(auth['canAny']).toHaveBeenCalledWith(['products.read', 'suppliers.read']);
    });

    it('sends the user away when they hold none of the anyPermission keys', async () => {
      auth['canAny'] = vi.fn().mockReturnValue(false);
      const route = { data: { anyPermission: ['products.read'] } } as unknown as ActivatedRouteSnapshot;

      await expect(run(route)).resolves.toBe(false);
    });

    it('sends the user to the Not in your plan page when the plan lacks the feature of the permission', async () => {
      const plans = TestBed.inject(PlanStore);
      plans.apply({ managed: true, features: ['inventory'], planName: 'Starter' } as SubscriptionDto);
      auth['can'] = vi.fn().mockReturnValue(false);
      const route = { data: { permission: 'promotions.read' } } as unknown as ActivatedRouteSnapshot;

      await expect(run(route)).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(`${AppRoutes.NotInPlan}?feature=promotions`);
    });

    it('opens a screen while the plan has it, then sends the person to Not in your plan once the plan shrinks', async () => {
      const plans = TestBed.inject(PlanStore);
      plans.apply({ managed: true, features: ['promotions'], planName: 'Pro' } as SubscriptionDto);
      auth['can'] = vi.fn().mockReturnValue(true);
      const route = { data: { permission: 'promotions.read' } } as unknown as ActivatedRouteSnapshot;

      expect(run(route)).toBe(true);
      expect(router.navigateByUrl).not.toHaveBeenCalled();

      plans.apply({ managed: true, features: ['inventory'], planName: 'Starter' } as SubscriptionDto);
      auth['can'] = vi.fn().mockReturnValue(false);

      await expect(run(route)).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(`${AppRoutes.NotInPlan}?feature=promotions`);
    });

    it('sends the person to Not in your plan when the plan shrinks but the saved permissions still list the feature', async () => {
      const plans = TestBed.inject(PlanStore);
      plans.apply({ managed: true, features: ['inventory'], planName: 'Starter' } as SubscriptionDto);
      auth['can'] = vi.fn().mockReturnValue(true);
      const route = { data: { permission: 'promotions.read' } } as unknown as ActivatedRouteSnapshot;

      await expect(run(route)).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(`${AppRoutes.NotInPlan}?feature=promotions`);
    });

    it('keeps the normal fallback when the plan has the feature but the role lacks the permission', async () => {
      const plans = TestBed.inject(PlanStore);
      plans.apply({ managed: true, features: ['promotions'], planName: 'Pro' } as SubscriptionDto);
      auth['can'] = vi.fn().mockReturnValue(false);
      auth['canReadOrders'].mockReturnValue(true);
      const route = { data: { permission: 'promotions.read' } } as unknown as ActivatedRouteSnapshot;

      await expect(run(route)).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrdersList);
    });

    it('asks the subscription service for the plan when it is not known yet', async () => {
      const loadPlan = vi.fn().mockImplementation(async () => {
        TestBed.inject(PlanStore).apply({ managed: true, features: ['inventory'], planName: 'Starter' } as SubscriptionDto);
        return true;
      });
      TestBed.overrideProvider(SubscriptionService, { useValue: { loadPlan } });
      auth['can'] = vi.fn().mockReturnValue(false);
      const route = { data: { permission: 'promotions.read' } } as unknown as ActivatedRouteSnapshot;

      await expect(run(route)).resolves.toBe(false);
      expect(loadPlan).toHaveBeenCalledTimes(1);
      expect(router.navigateByUrl).toHaveBeenCalledWith(`${AppRoutes.NotInPlan}?feature=promotions`);
    });

    it('opens the screen after an upgrade since sign-in once the plan and permissions are asked for again', async () => {
      let upgraded = false;
      auth['can'] = vi.fn().mockImplementation(() => upgraded);
      auth['loadPermissions'] = vi.fn().mockImplementation(() => {
        upgraded = true;
        return of(true);
      });
      const loadPlan = vi.fn().mockImplementation(async () => {
        TestBed.inject(PlanStore).apply({ managed: true, features: ['promotions'], planName: 'Pro' } as SubscriptionDto);
        return true;
      });
      TestBed.overrideProvider(SubscriptionService, { useValue: { loadPlan } });
      TestBed.inject(PlanStore).apply({ managed: true, features: ['inventory'], planName: 'Starter' } as SubscriptionDto);
      const route = { data: { permission: 'promotions.read' } } as unknown as ActivatedRouteSnapshot;

      await expect(run(route)).resolves.toBe(true);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('falls back to the login page when the first redirect is refused', async () => {
      router.navigateByUrl.mockResolvedValueOnce(false);
      auth['canReadOrders'].mockReturnValue(true);

      await expect(run(routeWithRoles([AppRoles.Admin]))).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenNthCalledWith(1, AppRoutes.OrdersList);
      expect(router.navigateByUrl).toHaveBeenNthCalledWith(2, AppRoutes.Login);
    });

    it('allows users holding one of the required roles', () => {
      auth['hasAnyRole'].mockReturnValue(true);

      expect(run(routeWithRoles([AppRoles.Admin]))).toBe(true);
      expect(auth['hasAnyRole']).toHaveBeenCalledWith([AppRoles.Admin]);
    });

    it('falls back to the orders list for users who can read orders', async () => {
      auth['canReadOrders'].mockReturnValue(true);

      await expect(run(routeWithRoles([AppRoles.Admin]))).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrdersList);
    });

    it('falls back to the dashboard for management readers without order access', async () => {
      auth['canReadManagement'].mockReturnValue(true);

      await expect(run(routeWithRoles([AppRoles.Admin]))).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Dashboard);
    });

    it('falls back to needs attention for stock managers', async () => {
      auth['canReadStockMovements'].mockReturnValue(true);

      await expect(run(routeWithRoles([AppRoles.Admin]))).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.InventoryAttention);
    });

    it('falls back to the items list for item managers', async () => {
      auth['canReadItems'].mockReturnValue(true);

      await expect(run(routeWithRoles([AppRoles.Admin]))).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.InventoryItems);
    });

    it('falls back to the Management hub for a role that holds only Management permissions', async () => {
      auth['canOpenManagementMenu'].mockReturnValue(true);

      await expect(run(routeWithRoles([AppRoles.Admin]))).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.ManagementRoot);
    });

    it('falls back to login when the user has no read access at all', async () => {
      await expect(run(routeWithRoles([AppRoles.Admin]))).resolves.toBe(false);
      expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Login);
    });
  });

  describe('unsavedChangesGuard', () => {
    const run = (component: HasUnsavedChanges) =>
      TestBed.runInInjectionContext(() =>
        unsavedChangesGuard(component, {} as ActivatedRouteSnapshot, state, state),
      );

    it('defers to the component', () => {
      expect(run({ canDeactivate: () => false })).toBe(false);
      expect(run({ canDeactivate: () => true })).toBe(true);
    });

    it('supports async confirmation', async () => {
      await expect(run({ canDeactivate: () => Promise.resolve(false) })).resolves.toBe(false);
    });

    it('leaves without asking when the plan took the screen away', () => {
      router.getCurrentNavigation.mockReturnValue({ extras: { info: { reason: 'not_in_plan', unsaved: true } } });
      const canDeactivate = vi.fn().mockReturnValue(false);

      expect(run({ canDeactivate })).toBe(true);
      expect(canDeactivate).not.toHaveBeenCalled();
    });

    it('still asks on any other navigation', () => {
      router.getCurrentNavigation.mockReturnValue({ extras: { info: { reason: 'something-else' } } });

      expect(run({ canDeactivate: () => false })).toBe(false);
    });

    it('allows leaving when the component has no canDeactivate', () => {
      expect(run({} as HasUnsavedChanges)).toBe(true);
    });
  });
});
