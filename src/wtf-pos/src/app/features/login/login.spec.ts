import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  AlertService,
  AuthLoadingService,
  AuthService,
  ModalStackService,
  OfflineOrderService,
} from '@core/services';
import { appVersion } from '@environments/version';
import { AppRoutes } from '@shared/constants/app-routes';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushMicrotasks, internals } from '../../testing/feature-spec-helpers';
import { Login } from './login';

describe('Login', () => {
  let auth: {
    isTokenValid: ReturnType<typeof vi.fn>;
    getRefreshToken: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    canReadManagement: ReturnType<typeof vi.fn>;
    canWriteOrders: ReturnType<typeof vi.fn>;
  };
  let alerts: { error: ReturnType<typeof vi.fn> };
  let offline: { getPendingSyncCount: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.fn>;

  function create(): ComponentFixture<Login> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: AlertService, useValue: alerts },
        { provide: OfflineOrderService, useValue: offline },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    return fixture;
  }

  function fill(fixture: ComponentFixture<Login>, username: string, password: string): void {
    internals(fixture.componentInstance)['loginForm'].setValue({ username, password });
    fixture.detectChanges();
  }

  function submitButton(fixture: ComponentFixture<Login>): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
  }

  beforeEach(() => {
    auth = {
      isTokenValid: vi.fn(() => false),
      getRefreshToken: vi.fn(() => null),
      refreshToken: vi.fn(() => of(false)),
      login: vi.fn(() => of(true)),
      canReadManagement: vi.fn(() => false),
      canWriteOrders: vi.fn(() => true),
    };
    alerts = { error: vi.fn() };
    offline = { getPendingSyncCount: vi.fn(() => Promise.resolve(0)) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering and validation', () => {
    it('renders the form with the app version', () => {
      const fixture = create();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('#username')).not.toBeNull();
      expect(el.querySelector('#password')).not.toBeNull();
      expect(el.textContent).toContain(`v${appVersion}`);
      expect(el.textContent).toContain(String(new Date().getFullYear()));
    });

    it('disables submit while the form is empty or partial', () => {
      const fixture = create();
      expect(submitButton(fixture).disabled).toBe(true);
      internals(fixture.componentInstance)['loginForm'].patchValue({ username: 'bob' });
      fixture.detectChanges();
      expect(submitButton(fixture).disabled).toBe(true);
    });

    it('enables submit once both fields are filled', () => {
      const fixture = create();
      fill(fixture, 'bob', 'secret');
      expect(submitButton(fixture).disabled).toBe(false);
    });

    it('toggles password visibility and button label', () => {
      const fixture = create();
      const el: HTMLElement = fixture.nativeElement;
      const password = el.querySelector('#password') as HTMLInputElement;
      const toggle = el.querySelector('button[type="button"]') as HTMLButtonElement;
      expect(password.type).toBe('password');
      expect(toggle.textContent?.trim()).toBe('Show');
      toggle.click();
      fixture.detectChanges();
      expect(password.type).toBe('text');
      expect(toggle.textContent?.trim()).toBe('Hide');
      expect(toggle.getAttribute('aria-label')).toBe('Hide password');
    });
  });

  describe('existing session', () => {
    it('routes straight away when the token is valid', async () => {
      auth.isTokenValid.mockReturnValue(true);
      create();
      await flushMicrotasks();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.OrdersEditor, { replaceUrl: true });
      expect(auth.refreshToken).not.toHaveBeenCalled();
    });

    it('stays on login when there is neither a valid token nor a refresh token', async () => {
      create();
      await flushMicrotasks();
      expect(navigate).not.toHaveBeenCalled();
      expect(auth.refreshToken).not.toHaveBeenCalled();
    });

    it('refreshes the session, toggling the checking flag, then routes on success', async () => {
      auth.getRefreshToken.mockReturnValue('r');
      const refresh = new Subject<boolean>();
      auth.refreshToken.mockReturnValue(refresh);
      const fixture = create();
      const loading = TestBed.inject(AuthLoadingService);
      expect(loading.checkingSession()).toBe(true);
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('form')?.getAttribute('aria-busy'),
      ).toBe('true');
      refresh.next(true);
      refresh.complete();
      await flushMicrotasks();
      expect(loading.checkingSession()).toBe(false);
      expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('stays on login when the refresh returns false', async () => {
      auth.getRefreshToken.mockReturnValue('r');
      create();
      await flushMicrotasks();
      expect(TestBed.inject(AuthLoadingService).checkingSession()).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('stays on login when the refresh errors', async () => {
      auth.getRefreshToken.mockReturnValue('r');
      auth.refreshToken.mockReturnValue(throwError(() => new Error('expired')));
      create();
      await flushMicrotasks();
      expect(TestBed.inject(AuthLoadingService).checkingSession()).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('gives up on a refresh that never completes after 30 seconds', () => {
      vi.useFakeTimers();
      auth.getRefreshToken.mockReturnValue('r');
      auth.refreshToken.mockReturnValue(NEVER);
      create();
      const loading = TestBed.inject(AuthLoadingService);
      expect(loading.checkingSession()).toBe(true);
      vi.advanceTimersByTime(30_000);
      expect(loading.checkingSession()).toBe(false);
    });

    it('ignores submit while the session check is running', () => {
      auth.getRefreshToken.mockReturnValue('r');
      auth.refreshToken.mockReturnValue(NEVER);
      const fixture = create();
      fill(fixture, 'bob', 'secret');
      internals(fixture.componentInstance)['login']();
      expect(auth.login).not.toHaveBeenCalled();
    });
  });

  describe('login submit', () => {
    it('calls auth.login with the entered credentials via the form submit', async () => {
      const fixture = create();
      fill(fixture, 'bob', 'secret');
      submitButton(fixture).click();
      expect(auth.login).toHaveBeenCalledWith('bob', 'secret');
      await flushMicrotasks();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.OrdersEditor, { replaceUrl: true });
    });

    it('shows a loading state while the request is in flight and ignores double submits', () => {
      const pending = new Subject<boolean>();
      auth.login.mockReturnValue(pending);
      const fixture = create();
      fill(fixture, 'bob', 'secret');
      internals(fixture.componentInstance)['login']();
      fixture.detectChanges();
      expect(internals(fixture.componentInstance)['loading']()).toBe(true);
      expect(submitButton(fixture).textContent).toContain('Logging in...');
      expect(submitButton(fixture).disabled).toBe(true);
      internals(fixture.componentInstance)['login']();
      expect(auth.login).toHaveBeenCalledTimes(1);
      pending.next(true);
      pending.complete();
      expect(internals(fixture.componentInstance)['loading']()).toBe(false);
    });

    it('alerts when the server responds with a falsy result', async () => {
      auth.login.mockReturnValue(of(false));
      const fixture = create();
      fill(fixture, 'bob', 'secret');
      internals(fixture.componentInstance)['login']();
      expect(alerts.error).toHaveBeenCalledWith('Login failed. Invalid response from server.');
      expect(navigate).not.toHaveBeenCalled();
      expect(internals(fixture.componentInstance)['loading']()).toBe(false);
    });

    it('surfaces the error message from the service', () => {
      auth.login.mockReturnValue(throwError(() => new Error('Invalid credentials')));
      const fixture = create();
      fill(fixture, 'bob', 'wrong');
      internals(fixture.componentInstance)['login']();
      expect(alerts.error).toHaveBeenCalledWith('Invalid credentials');
      expect(internals(fixture.componentInstance)['loading']()).toBe(false);
    });

    it('falls back to a generic message when the error has no message', () => {
      auth.login.mockReturnValue(throwError(() => ({})));
      const fixture = create();
      fill(fixture, 'bob', 'wrong');
      internals(fixture.componentInstance)['login']();
      expect(alerts.error).toHaveBeenCalledWith('Login failed. Please try again.');
    });

    it('reports a timeout when the request takes longer than 30 seconds', () => {
      vi.useFakeTimers();
      auth.login.mockReturnValue(NEVER);
      const fixture = create();
      fill(fixture, 'bob', 'secret');
      internals(fixture.componentInstance)['login']();
      vi.advanceTimersByTime(30_000);
      expect(alerts.error).toHaveBeenCalledWith('Login request timed out. Please try again.');
      expect(internals(fixture.componentInstance)['loading']()).toBe(false);
    });
  });

  describe('post-login redirect', () => {
    async function loginAs(): Promise<void> {
      const fixture = create();
      fill(fixture, 'bob', 'secret');
      internals(fixture.componentInstance)['login']();
      await flushMicrotasks();
    }

    it('sends management users to the dashboard', async () => {
      auth.canReadManagement.mockReturnValue(true);
      await loginAs();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.Dashboard, { replaceUrl: true });
    });

    it('sends order writers to the order editor', async () => {
      await loginAs();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.OrdersEditor, { replaceUrl: true });
    });

    it('sends read-only users to the order list', async () => {
      auth.canWriteOrders.mockReturnValue(false);
      await loginAs();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.OrdersList, { replaceUrl: true });
    });
  });

  describe('pending offline orders reminder', () => {
    async function loginWithPending(count: number) {
      offline.getPendingSyncCount.mockResolvedValue(count);
      const fixture = create();
      fill(fixture, 'bob', 'secret');
      internals(fixture.componentInstance)['login']();
      await flushMicrotasks();
      fixture.detectChanges();
      return fixture;
    }

    it('shows the dialog instead of navigating when orders are waiting', async () => {
      const fixture = await loginWithPending(3);
      const el: HTMLElement = fixture.nativeElement;
      expect(navigate).not.toHaveBeenCalled();
      expect(el.querySelector('app-confirm-dialog')).not.toBeNull();
      expect(el.textContent).toContain('Pending Offline Orders');
      expect(el.textContent).toContain('orders waiting to sync');
      expect(internals(fixture.componentInstance)['pendingSyncCount']()).toBe(3);
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(true);
    });

    it('uses the singular wording for one pending order', async () => {
      const fixture = await loginWithPending(1);
      const text = (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
      expect(text).toContain('order waiting to sync');
      expect(text).not.toContain('orders waiting');
    });

    it('goToOrderList closes the dialog and opens the order list', async () => {
      const fixture = await loginWithPending(2);
      internals(fixture.componentInstance)['goToOrderList']();
      fixture.detectChanges();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.OrdersList, { replaceUrl: true });
      expect((fixture.nativeElement as HTMLElement).querySelector('app-confirm-dialog')).toBeNull();
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('dismissing continues to the default route and closes the dialog', async () => {
      auth.canReadManagement.mockReturnValue(true);
      const fixture = await loginWithPending(2);
      internals(fixture.componentInstance)['dismissPendingSyncReminder']();
      fixture.detectChanges();
      expect(navigate).toHaveBeenCalledWith(AppRoutes.Dashboard, { replaceUrl: true });
      expect((fixture.nativeElement as HTMLElement).querySelector('app-confirm-dialog')).toBeNull();
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('the hardware back button (modal stack pop) dismisses the reminder', async () => {
      await loginWithPending(2);
      expect(TestBed.inject(ModalStackService).pop()).toBe(true);
      expect(navigate).toHaveBeenCalledWith(AppRoutes.OrdersEditor, { replaceUrl: true });
    });

    it('removes its modal stack entry when destroyed', async () => {
      const fixture = await loginWithPending(2);
      fixture.destroy();
      expect(TestBed.inject(ModalStackService).hasOpen()).toBe(false);
    });

    it('does not run the routing check twice concurrently', async () => {
      auth.isTokenValid.mockReturnValue(true);
      let resolveCount: (n: number) => void = () => undefined;
      offline.getPendingSyncCount.mockReturnValue(
        new Promise<number>((resolve) => {
          resolveCount = resolve;
        }),
      );
      const fixture = create();
      void internals(fixture.componentInstance)['routeAfterSuccessfulAuth']();
      expect(offline.getPendingSyncCount).toHaveBeenCalledTimes(1);
      resolveCount(0);
      await flushMicrotasks();
      expect(navigate).toHaveBeenCalledTimes(1);
    });
  });
});
