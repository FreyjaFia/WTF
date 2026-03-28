import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { environment } from '@environments/environment.development';
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { Subscription, firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { AlertService } from './alert.service';
import { ServiceErrorMessages } from '@core/messages';
import { AppRoutes } from '@shared/constants/app-routes';

type PushPlatform = 'web' | 'android';

@Injectable({ providedIn: 'root' })
export class PushNotificationService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(AlertService);
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router);
  private readonly baseUrl = `${environment.apiUrl}/push`;
  private loginSub: Subscription | null = null;
  private tokenSub: Subscription | null = null;
  private initialized = false;
  private androidListenersReady = false;
  private androidDeviceId: string | null = null;

  public init(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.loginSub = this.auth.isLoggedIn$.subscribe((isLoggedIn) => {
      if (isLoggedIn) {
        void this.register();
      } else {
        void this.unregister();
      }
    });

    this.tokenSub = this.auth.tokenRefreshed$.subscribe(() => {
      void this.register();
    });
  }

  public ngOnDestroy(): void {
    this.loginSub?.unsubscribe();
    this.tokenSub?.unsubscribe();
  }

  public triggerRefresh(): void {
    void this.register();
  }

  private async register(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.registerAndroid();
      return;
    }

    await this.registerWeb();
  }

  private async unregister(): Promise<void> {
    const token = localStorage.getItem('pushToken');
    const platform = localStorage.getItem('pushPlatform');
    if (!token || !platform) {
      return;
    }

    try {
      await firstValueFrom(
        this.http.post<void>(`${this.baseUrl}/unsubscribe`, { token, platform }),
      );
    } catch (_error) {
      void _error;
    }

    localStorage.removeItem('pushToken');
    localStorage.removeItem('pushPlatform');
  }

  private async registerWeb(): Promise<void> {
    if (!environment.firebaseConfig || !environment.firebaseVapidKey) {
      return;
    }

    if (!(await isSupported())) {
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return;
    }

    const app = initializeApp(environment.firebaseConfig);
    const messaging = getMessaging(app);
    const swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, {
      vapidKey: environment.firebaseVapidKey,
      serviceWorkerRegistration: swRegistration,
    });

    if (!token) {
      return;
    }

    await this.registerToken(token, 'web');

    onMessage(messaging, (payload) => {
      this.zone.run(() => {
        const notification = payload.notification;
        if (!notification?.title || Notification.permission !== 'granted') {
          return;
        }

        const data = payload.data || {};
        const orderId = data['orderId'];
        const path =
          data['path'] ||
          (orderId ? AppRoutes.OrderEditorById(String(orderId)) : AppRoutes.OrdersList);
        const targetUrl = new URL(path, window.location.origin).toString();

        const systemNotification = new Notification(notification.title, {
          body: notification.body,
          icon: 'assets/images/icon-192.png',
          data: payload.data || {},
        });

        systemNotification.onclick = () => {
          window.focus();
          window.location.assign(targetUrl);
        };
      });
    });
  }

  private async registerAndroid(): Promise<void> {
    const permissions = await PushNotifications.requestPermissions();
    if (permissions.receive !== 'granted') {
      return;
    }

    const localPermissions = await LocalNotifications.requestPermissions();
    if (localPermissions.display !== 'granted') {
      // Continue; push registration still works without local notifications.
      void localPermissions;
    }

    await LocalNotifications.createChannel({
      id: 'orders',
      name: 'Orders',
      description: 'Order notifications',
      importance: 5,
      visibility: 1,
      sound: 'default',
    });

    const deviceId = await Device.getId();
    this.androidDeviceId = deviceId.identifier;

    await PushNotifications.register();

    if (!this.androidListenersReady) {
      this.androidListenersReady = true;
      PushNotifications.addListener('registration', (token) => {
        void this.registerToken(token.value, 'android', this.androidDeviceId);
      });

      PushNotifications.addListener('registrationError', (_error) => {
        void _error;
      });

      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        void this.showLocalNotification(notification);
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
        const data = this.extractNotificationData(event.notification?.data);
        const path =
          data['path'] ??
          (data['orderId']
            ? AppRoutes.OrderDetailsById(String(data['orderId']))
            : '');
        if (path) {
          void this.navigateToPath(path);
        }
      });

      LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        const path = event.notification?.extra?.path as string | undefined;
        if (path) {
          void this.navigateToPath(path);
        }
      });
    }
  }

  private async registerToken(
    token: string,
    platform: PushPlatform,
    deviceId: string | null = null,
  ): Promise<void> {
    const payload = { token, platform, deviceId };
    await firstValueFrom(this.http.post<void>(`${this.baseUrl}/subscribe`, payload));
    localStorage.setItem('pushToken', token);
    localStorage.setItem('pushPlatform', platform);
  }

  private async showLocalNotification(notification: {
    title?: string;
    body?: string;
    data?: Record<string, string>;
  }): Promise<void> {
    if (!notification?.title && !notification?.body) {
      return;
    }

    const data = notification.data || {};
    const orderId = data['orderId'];
    const path =
      data['path'] ||
      (orderId ? AppRoutes.OrderDetailsById(String(orderId)) : AppRoutes.OrdersList);
    const id = Math.floor(Math.random() * 1_000_000);

    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title: notification.title ?? 'WTF POS',
          body: notification.body ?? '',
          extra: { path },
          channelId: 'orders',
          smallIcon: 'ic_stat_wtfv2',
        },
      ],
    });
  }

  private async navigateToPath(path: string): Promise<void> {
    const canNavigate = await this.ensureSession();
    if (!canNavigate) {
      this.zone.run(() => {
        this.alerts.error(ServiceErrorMessages.Auth.SessionExpired);
        this.router.navigateByUrl(AppRoutes.Login, { replaceUrl: true });
      });
      return;
    }

    this.zone.run(() => {
      this.router.navigateByUrl(path).catch(() => {
        window.location.assign(path);
      });
    });
  }

  private extractNotificationData(payload: unknown): Record<string, string> {
    if (!payload) {
      return {};
    }

    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload) as Record<string, string>;
      } catch {
        return {};
      }
    }

    if (typeof payload === 'object') {
      return payload as Record<string, string>;
    }

    return {};
  }

  private async ensureSession(): Promise<boolean> {
    if (this.auth.isTokenValid()) {
      return true;
    }

    const refreshToken = this.auth.getRefreshToken();
    if (!refreshToken) {
      return false;
    }

    try {
      return await firstValueFrom(this.auth.refreshToken());
    } catch {
      return false;
    }
  }
}
