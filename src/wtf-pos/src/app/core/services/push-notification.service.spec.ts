import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { ServiceErrorMessages } from '@core/messages';
import { AppRoutes } from '@shared/constants/app-routes';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from './alert.service';
import { AuthService } from './auth.service';
import { PushNotificationService } from './push-notification.service';
import { NotificationService } from './notification.service';

const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(),
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  isSupported: vi.fn(),
  onMessage: vi.fn(),
  pushRequestPermissions: vi.fn(),
  pushRegister: vi.fn(),
  pushAddListener: vi.fn(),
  localRequestPermissions: vi.fn(),
  localCreateChannel: vi.fn(),
  localSchedule: vi.fn(),
  localAddListener: vi.fn(),
  deviceGetId: vi.fn(),
}));

vi.mock('firebase/app', () => ({ initializeApp: mocks.initializeApp }));
vi.mock('firebase/messaging', () => ({
  getMessaging: mocks.getMessaging,
  getToken: mocks.getToken,
  isSupported: mocks.isSupported,
  onMessage: mocks.onMessage,
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: mocks.pushRequestPermissions,
    register: mocks.pushRegister,
    addListener: mocks.pushAddListener,
  },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    requestPermissions: mocks.localRequestPermissions,
    createChannel: mocks.localCreateChannel,
    schedule: mocks.localSchedule,
    addListener: mocks.localAddListener,
  },
}));
vi.mock('@capacitor/device', () => ({ Device: { getId: mocks.deviceGetId } }));

class FakeNotification {
  public static permission = 'granted';
  public static requestPermission = vi.fn();
  public static instances: FakeNotification[] = [];
  public onclick: (() => void) | null = null;

  constructor(
    public title: string,
    public options: Record<string, unknown>,
  ) {
    FakeNotification.instances.push(this);
  }
}

describe('PushNotificationService', () => {
  let service: PushNotificationService;
  let http: HttpTestingController;
  let loggedIn$: BehaviorSubject<boolean>;
  let tokenRefreshed$: Subject<void>;
  let auth: {
    isLoggedIn$: BehaviorSubject<boolean>;
    tokenRefreshed$: Subject<void>;
    isTokenValid: ReturnType<typeof vi.fn>;
    getRefreshToken: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
  };
  let alerts: { error: ReturnType<typeof vi.fn> };
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };

  const subscribeUrl = 'http://localhost:5282/api/push/subscribe';
  const unsubscribeUrl = 'http://localhost:5282/api/push/unsubscribe';

  /** Waits for the next HTTP request to the URL, then answers it. */
  async function respond(url: string): Promise<unknown> {
    let body: unknown;
    await vi.waitFor(() => {
      const req = http.expectOne(url);
      body = req.request.body;
      req.flush(null);
    });
    return body;
  }

  function setup(): void {
    loggedIn$ = new BehaviorSubject<boolean>(false);
    tokenRefreshed$ = new Subject<void>();
    auth = {
      isLoggedIn$: loggedIn$,
      tokenRefreshed$,
      isTokenValid: vi.fn().mockReturnValue(true),
      getRefreshToken: vi.fn().mockReturnValue('refresh'),
      refreshToken: vi.fn().mockReturnValue(of(true)),
    };
    alerts = { error: vi.fn() };
    router = { navigateByUrl: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: AlertService, useValue: alerts },
        { provide: Router, useValue: router },
      ],
    });
    service = TestBed.inject(PushNotificationService);
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    localStorage.clear();
    for (const fn of Object.values(mocks)) {
      fn.mockReset();
    }
    FakeNotification.instances = [];
    FakeNotification.permission = 'granted';
    FakeNotification.requestPermission.mockReset().mockResolvedValue('granted');
    vi.stubGlobal('Notification', FakeNotification);
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('web', () => {
    let register: ReturnType<typeof vi.fn>;
    let previousSw: PropertyDescriptor | undefined;

    beforeEach(() => {
      register = vi.fn().mockResolvedValue({ active: {} });
      previousSw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { register },
        configurable: true,
      });
      mocks.isSupported.mockResolvedValue(true);
      mocks.getToken.mockResolvedValue('web-token');
      mocks.getMessaging.mockReturnValue({ id: 'messaging' });
      mocks.initializeApp.mockReturnValue({ id: 'app' });
      setup();
    });

    afterEach(() => {
      if (previousSw) {
        Object.defineProperty(navigator, 'serviceWorker', previousSw);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    });

    it('registers the web token when the user is logged in', async () => {
      loggedIn$.next(true);
      service.init();

      const body = await respond(subscribeUrl);

      expect(body).toEqual({ token: 'web-token', platform: 'web', deviceId: null });
      expect(register).toHaveBeenCalledWith('/firebase-messaging-sw.js');
      expect(mocks.getToken.mock.calls[0][1]).toMatchObject({
        serviceWorkerRegistration: { active: {} },
      });
      await vi.waitFor(() => expect(localStorage.getItem('pushToken')).toBe('web-token'));
      expect(localStorage.getItem('pushPlatform')).toBe('web');
      expect(mocks.onMessage).toHaveBeenCalledTimes(1);
    });

    it('init is idempotent', async () => {
      loggedIn$.next(true);
      service.init();
      service.init();

      await respond(subscribeUrl);
      http.expectNone(subscribeUrl);
      expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
    });

    it('does not register while logged out and has nothing to unregister', async () => {
      service.init();

      await Promise.resolve();
      http.expectNone(subscribeUrl);
      http.expectNone(unsubscribeUrl);
      expect(mocks.isSupported).not.toHaveBeenCalled();
    });

    it('unsubscribes and clears storage on logout', async () => {
      localStorage.setItem('pushToken', 'old');
      localStorage.setItem('pushPlatform', 'web');
      loggedIn$.next(true);
      service.init();
      await respond(subscribeUrl);
      localStorage.setItem('pushToken', 'old');

      loggedIn$.next(false);
      const body = await respond(unsubscribeUrl);

      expect(body).toEqual({ token: 'old', platform: 'web' });
      await vi.waitFor(() => expect(localStorage.getItem('pushToken')).toBeNull());
      expect(localStorage.getItem('pushPlatform')).toBeNull();
    });

    it('clears storage even when the unsubscribe request fails', async () => {
      localStorage.setItem('pushToken', 'old');
      localStorage.setItem('pushPlatform', 'web');
      service.init();

      await vi.waitFor(() => {
        http.expectOne(unsubscribeUrl).flush('boom', { status: 500, statusText: 'Server Error' });
      });

      await vi.waitFor(() => expect(localStorage.getItem('pushToken')).toBeNull());
      expect(localStorage.getItem('pushPlatform')).toBeNull();
    });

    it('re-registers when the token is refreshed', async () => {
      service.init();

      tokenRefreshed$.next();

      await respond(subscribeUrl);
    });

    it('triggerRefresh registers immediately', async () => {
      service.triggerRefresh();

      await respond(subscribeUrl);
    });

    it('skips registration when messaging is unsupported', async () => {
      mocks.isSupported.mockResolvedValue(false);

      service.triggerRefresh();
      await vi.waitFor(() => expect(mocks.isSupported).toHaveBeenCalled());
      await Promise.resolve();

      expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
      http.expectNone(subscribeUrl);
    });

    it('skips registration when permission is denied', async () => {
      FakeNotification.requestPermission.mockResolvedValue('denied');

      service.triggerRefresh();
      await vi.waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalled());
      await Promise.resolve();

      expect(mocks.initializeApp).not.toHaveBeenCalled();
      http.expectNone(subscribeUrl);
    });

    it('skips the subscribe call when Firebase returns no token', async () => {
      mocks.getToken.mockResolvedValue('');

      service.triggerRefresh();
      await vi.waitFor(() => expect(mocks.getToken).toHaveBeenCalled());
      await Promise.resolve();

      http.expectNone(subscribeUrl);
      expect(mocks.onMessage).not.toHaveBeenCalled();
    });

    it('waits for an installing service worker to activate', async () => {
      const listeners: Record<string, () => void> = {};
      const worker = {
        state: 'installing',
        addEventListener: vi.fn((name: string, cb: () => void) => {
          listeners[name] = cb;
        }),
        removeEventListener: vi.fn(),
      };
      register.mockResolvedValue({ active: null, installing: worker });

      service.triggerRefresh();
      await vi.waitFor(() => expect(worker.addEventListener).toHaveBeenCalled());
      expect(mocks.getToken).not.toHaveBeenCalled();

      worker.state = 'activated';
      listeners['statechange']();

      await respond(subscribeUrl);
      expect(worker.removeEventListener).toHaveBeenCalledWith('statechange', listeners['statechange']);
    });

    it('does not wait when there is no worker at all', async () => {
      register.mockResolvedValue({ active: null, installing: null, waiting: null });

      service.triggerRefresh();

      await respond(subscribeUrl);
    });

    describe('foreground messages', () => {
      let onMessageHandler: (payload: unknown) => void;

      beforeEach(async () => {
        service.triggerRefresh();
        await respond(subscribeUrl);
        onMessageHandler = mocks.onMessage.mock.calls[0][1];
      });

      it('refreshes the notification counts when a notification arrives', () => {
        const refresh = vi.spyOn(TestBed.inject(NotificationService), 'refreshCounts').mockImplementation(() => undefined);

        onMessageHandler({
          notification: { title: 'Low stock: Milk', body: '400 ml left.' },
          data: { type: 'stock-alert', path: '/inventory/alerts', itemId: 'i1' },
        });
        onMessageHandler({ notification: { title: 'New order' }, data: { orderId: '42' } });

        expect(refresh).toHaveBeenCalledTimes(1);
      });

      it('keeps the path of a stock alert so a click opens it', () => {
        vi.spyOn(TestBed.inject(NotificationService), 'refreshCounts').mockImplementation(() => undefined);

        onMessageHandler({
          notification: { title: 'Low stock: Milk' },
          data: { type: 'stock-alert', path: '/inventory/alerts', itemId: 'i1' },
        });

        const shown = FakeNotification.instances[0];
        expect(shown.options).toMatchObject({ data: { type: 'stock-alert', path: '/inventory/alerts' } });
      });

      it('shows a system notification with title, body and icon', () => {
        onMessageHandler({
          notification: { title: 'New order', body: 'Order #1' },
          data: { orderId: '42' },
        });

        expect(FakeNotification.instances).toHaveLength(1);
        const shown = FakeNotification.instances[0];
        expect(shown.title).toBe('New order');
        expect(shown.options).toMatchObject({
          body: 'Order #1',
          icon: 'assets/images/icon-192.png',
          data: { orderId: '42' },
        });
        expect(typeof shown.onclick).toBe('function');
      });

      /** Taps every shown notification and returns the addresses the page was sent to. */
      const tapAll = (): string[] => {
        const assign = vi.fn();
        vi.stubGlobal('location', { origin: 'http://localhost', assign });
        try {
          for (const shown of FakeNotification.instances) {
            shown.onclick!();
          }
        } finally {
          vi.unstubAllGlobals();
        }
        return assign.mock.calls.map((c) => c[0] as string);
      };
      // The address is built when the message arrives, so it uses the page's real origin.
      const url = (path: string) => new URL(path, window.location.origin).toString();

      it('opens the order editor for an ordinary new order when no path is given', () => {
        onMessageHandler({ notification: { title: 'New order' }, data: { orderId: '42' } });

        expect(tapAll()).toEqual([url(AppRoutes.OrderEditorById('42'))]);
      });

      it('opens the order with its chat open for a chat message', () => {
        const title = { title: 'New message on order #42' };
        onMessageHandler({
          notification: title,
          data: { type: 'order-message', orderId: '42', path: '/orders/details/42', chat: 'open' },
        });
        onMessageHandler({
          notification: title,
          data: { type: 'order-message', orderId: '42', path: '/orders/editor/42', chat: 'open' },
        });

        expect(tapAll()).toEqual([url('/orders/details/42?chat=open'), url('/orders/editor/42?chat=open')]);
      });

      it('opens the orders list for an online order, never the editor', () => {
        const title = { title: 'New online order' };
        onMessageHandler({
          notification: title,
          data: { type: 'online-order', orderId: '42', path: '/orders/list' },
        });
        onMessageHandler({ notification: title, data: { type: 'online-order', orderId: '42' } });
        onMessageHandler({
          notification: title,
          data: { type: 'online-order', orderId: '42', path: AppRoutes.OrderEditorById('42') },
        });

        expect(tapAll()).toEqual([
          url('/orders/list'),
          url(AppRoutes.OrdersList),
          url(AppRoutes.OrdersList),
        ]);
      });

      it('ignores payloads without a title', () => {
        onMessageHandler({ notification: { body: 'x' } });
        onMessageHandler({});

        expect(FakeNotification.instances).toHaveLength(0);
      });

      it('ignores messages when notification permission is no longer granted', () => {
        FakeNotification.permission = 'denied';

        onMessageHandler({ notification: { title: 'Hi' } });

        expect(FakeNotification.instances).toHaveLength(0);
      });
    });
  });

  describe('android', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      mocks.pushRequestPermissions.mockResolvedValue({ receive: 'granted' });
      mocks.localRequestPermissions.mockResolvedValue({ display: 'granted' });
      mocks.localCreateChannel.mockResolvedValue(undefined);
      mocks.localSchedule.mockResolvedValue(undefined);
      mocks.deviceGetId.mockResolvedValue({ identifier: 'device-1' });
      mocks.pushRegister.mockResolvedValue(undefined);
      setup();
    });

    const listener = (name: string): ((arg: never) => void) => {
      const call = mocks.pushAddListener.mock.calls.find((c) => c[0] === name);
      if (!call) {
        throw new Error(`listener ${name} not registered`);
      }
      return call[1];
    };

    async function registerAndroid(): Promise<void> {
      service.triggerRefresh();
      await vi.waitFor(() => expect(mocks.pushAddListener).toHaveBeenCalled());
    }

    it('does nothing when push permission is denied', async () => {
      mocks.pushRequestPermissions.mockResolvedValue({ receive: 'denied' });

      service.triggerRefresh();
      await vi.waitFor(() => expect(mocks.pushRequestPermissions).toHaveBeenCalled());
      await Promise.resolve();

      expect(mocks.pushRegister).not.toHaveBeenCalled();
      expect(mocks.localCreateChannel).not.toHaveBeenCalled();
    });

    it('creates the orders channel and registers for FCM', async () => {
      await registerAndroid();

      expect(mocks.localCreateChannel.mock.calls[0][0]).toMatchObject({
        id: 'orders',
        importance: 5,
      });
      expect(mocks.pushRegister).toHaveBeenCalledTimes(1);
    });

    it('continues registering when local notification permission is denied', async () => {
      mocks.localRequestPermissions.mockResolvedValue({ display: 'denied' });

      await registerAndroid();

      expect(mocks.pushRegister).toHaveBeenCalled();
    });

    it('subscribes the FCM token with the device id', async () => {
      await registerAndroid();

      listener('registration')({ value: 'fcm-token' } as never);

      const body = await respond(subscribeUrl);
      expect(body).toEqual({ token: 'fcm-token', platform: 'android', deviceId: 'device-1' });
      await vi.waitFor(() => expect(localStorage.getItem('pushPlatform')).toBe('android'));
    });

    it('only attaches listeners once across repeated registrations', async () => {
      await registerAndroid();
      const count = mocks.pushAddListener.mock.calls.length;

      service.triggerRefresh();
      await vi.waitFor(() => expect(mocks.pushRegister).toHaveBeenCalledTimes(2));

      expect(mocks.pushAddListener.mock.calls).toHaveLength(count);
    });

    it('falls back to FCM when the Huawei plugin is unavailable (not implemented on web)', async () => {
      await registerAndroid();

      expect(mocks.pushRegister).toHaveBeenCalledTimes(1);
    });

    it('registrationError listener does not throw', async () => {
      await registerAndroid();

      expect(() => listener('registrationError')(new Error('x') as never)).not.toThrow();
    });

    describe('received notifications', () => {
      beforeEach(registerAndroid);

      it('refreshes the notification counts when a notification arrives', () => {
        const refresh = vi.spyOn(TestBed.inject(NotificationService), 'refreshCounts').mockImplementation(() => undefined);

        listener('pushNotificationReceived')({
          title: 'Low stock: Milk',
          body: '400 ml left.',
          data: { type: 'stock-alert', path: '/inventory/alerts' },
        } as never);
        listener('pushNotificationReceived')({ title: 'Order', data: { orderId: '7' } } as never);

        expect(refresh).toHaveBeenCalledTimes(1);
      });

      it('schedules a local notification routed to the order details', async () => {
        listener('pushNotificationReceived')({
          title: 'Order',
          body: 'Ready',
          data: { orderId: '7' },
        } as never);

        await vi.waitFor(() => expect(mocks.localSchedule).toHaveBeenCalled());
        const scheduled = mocks.localSchedule.mock.calls[0][0].notifications[0];
        expect(scheduled).toMatchObject({
          title: 'Order',
          body: 'Ready',
          channelId: 'orders',
          smallIcon: 'ic_stat_wtfv2',
          extra: { path: AppRoutes.OrderDetailsById('7') },
        });
        expect(Number.isInteger(scheduled.id)).toBe(true);
      });

      it('prefers an explicit path and falls back to the orders list', async () => {
        listener('pushNotificationReceived')({ title: 'A', data: { path: '/custom' } } as never);
        listener('pushNotificationReceived')({ body: 'B' } as never);

        await vi.waitFor(() => expect(mocks.localSchedule).toHaveBeenCalledTimes(2));
        const [first, second] = mocks.localSchedule.mock.calls.map((c) => c[0].notifications[0]);
        expect(first.extra.path).toBe('/custom');
        expect(first.body).toBe('');
        expect(second.extra.path).toBe(AppRoutes.OrdersList);
        expect(second.title).toBe('WTF POS');
      });

      it('opens the orders list for an online order, even from a payload that names only the order', async () => {
        listener('pushNotificationReceived')({
          title: 'New online order',
          data: { type: 'online-order', orderId: '7' },
        } as never);
        listener('pushNotificationReceived')({
          title: 'New online order',
          data: { type: 'online-order', orderId: '7', path: '/orders/editor/7' },
        } as never);

        await vi.waitFor(() => expect(mocks.localSchedule).toHaveBeenCalledTimes(2));
        const paths = mocks.localSchedule.mock.calls.map((c) => c[0].notifications[0].extra.path);
        expect(paths).toEqual([AppRoutes.OrdersList, AppRoutes.OrdersList]);
      });

      it('ignores notifications without title and body', async () => {
        listener('pushNotificationReceived')({ data: { orderId: '1' } } as never);
        await Promise.resolve();

        expect(mocks.localSchedule).not.toHaveBeenCalled();
      });
    });

    describe('tapping notifications', () => {
      beforeEach(registerAndroid);

      const tap = (data: unknown): void =>
        listener('pushNotificationActionPerformed')({ notification: { data } } as never);

      it('navigates to the order details for an orderId', async () => {
        tap({ orderId: '9' });

        await vi.waitFor(() =>
          expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('9')),
        );
      });

      it('opens the orders list when an online order notification is tapped', async () => {
        tap({ type: 'online-order', orderId: '9', path: '/orders/list' });

        await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledWith('/orders/list'));
      });

      it('opens the order with its chat when a chat message is tapped', async () => {
        tap({ type: 'order-message', orderId: '9', path: '/orders/details/9', chat: 'open' });

        await vi.waitFor(() =>
          expect(router.navigateByUrl).toHaveBeenCalledWith('/orders/details/9?chat=open'),
        );
      });

      it('falls back to the order details for a chat message with no path, and adds the chat once', async () => {
        tap({ type: 'order-message', orderId: '9', chat: 'open' });
        tap({ type: 'order-message', orderId: '9', path: '/orders/details/9?chat=open', chat: 'open' });
        tap({ type: 'order-message', orderId: '9', path: '/orders/details/9' });

        await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledTimes(3));
        expect(
          (router.navigateByUrl as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]),
        ).toEqual([AppRoutes.OrderDetailsById('9') + '?chat=open', '/orders/details/9?chat=open', '/orders/details/9']);
      });

      it('sends an online order tap to the list even if the payload points at the editor or has no path', async () => {
        tap({ type: 'online-order', orderId: '9', path: AppRoutes.OrderEditorById('9') });
        tap({ type: 'online-order', orderId: '9' });
        tap({ type: 'online-order' });

        await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledTimes(3));
        expect(
          (router.navigateByUrl as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]),
        ).toEqual([AppRoutes.OrdersList, AppRoutes.OrdersList, AppRoutes.OrdersList]);
      });

      it('still sends an ordinary order notification to its details', async () => {
        tap({ orderId: '5', status: 'Completed' });

        await vi.waitFor(() =>
          expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('5')),
        );
      });

      it('parses JSON string payloads and prefers path', async () => {
        tap(JSON.stringify({ path: '/orders/list', orderId: '9' }));

        await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledWith('/orders/list'));
      });

      it('does not navigate for invalid JSON, empty or unusable payloads', async () => {
        tap('{not json');
        tap(undefined);
        tap(42);
        tap({});
        await Promise.resolve();

        expect(router.navigateByUrl).not.toHaveBeenCalled();
      });

      it('navigates from a tapped local notification', async () => {
        const call = mocks.localAddListener.mock.calls.find(
          (c) => c[0] === 'localNotificationActionPerformed',
        );

        call?.[1]({ notification: { extra: { path: '/dashboard' } } });
        call?.[1]({ notification: {} });

        await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard'));
        expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      });

      it('refreshes an expired token before navigating', async () => {
        auth.isTokenValid.mockReturnValue(false);

        tap({ orderId: '3' });

        await vi.waitFor(() =>
          expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('3')),
        );
        expect(auth.refreshToken).toHaveBeenCalledTimes(1);
      });

      it.each([
        ['there is no refresh token', () => auth.getRefreshToken.mockReturnValue(null)],
        ['the refresh fails', () => auth.refreshToken.mockReturnValue(of(false))],
        [
          'the refresh errors',
          () => auth.refreshToken.mockReturnValue(throwError(() => new Error('x'))),
        ],
      ])('redirects to login when %s', async (_name, arrange) => {
        auth.isTokenValid.mockReturnValue(false);
        arrange();

        tap({ orderId: '3' });

        await vi.waitFor(() =>
          expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Login, { replaceUrl: true }),
        );
        expect(alerts.error).toHaveBeenCalledWith(ServiceErrorMessages.Auth.SessionExpired);
      });
    });
  });

  it('stops reacting to auth changes after destroy', async () => {
    mocks.isSupported.mockResolvedValue(false);
    setup();
    service.init();

    service.ngOnDestroy();
    loggedIn$.next(true);
    tokenRefreshed$.next();
    await Promise.resolve();

    expect(mocks.isSupported).not.toHaveBeenCalled();
  });
});
