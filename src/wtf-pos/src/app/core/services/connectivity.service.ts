import { HttpClient } from '@angular/common/http';
import { inject, Injectable, NgZone, OnDestroy, signal } from '@angular/core';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { environment } from '@environments/environment.development';
import { catchError, firstValueFrom, map, of, timeout } from 'rxjs';

interface NetworkStatus {
  connected: boolean;
}

interface NetworkPlugin {
  getStatus(): Promise<NetworkStatus>;
  addListener(
    eventName: 'networkStatusChange',
    listenerFunc: (status: NetworkStatus) => void,
  ): Promise<PluginListenerHandle>;
}

const Network = registerPlugin<NetworkPlugin>('Network');

export enum ConnectivityState {
  OFFLINE = 'OFFLINE',
  SERVER_UNREACHABLE = 'SERVER_UNREACHABLE',
  ONLINE = 'ONLINE',
}

@Injectable({ providedIn: 'root' })
export class ConnectivityService implements OnDestroy {
  private static readonly MANUAL_CHECK_THROTTLE_MS = 3000;
  private static readonly HEALTH_TIMEOUT_MS = 3000;
  private static readonly OFFLINE_RECHECK_MS = 5000;

  private readonly http = inject(HttpClient);
  private readonly zone = inject(NgZone);

  private readonly _state = signal<ConnectivityState>(
    navigator.onLine ? ConnectivityState.SERVER_UNREACHABLE : ConnectivityState.OFFLINE,
  );
  public readonly state = this._state.asReadonly();

  private readonly _isOnline = signal(this._state() === ConnectivityState.ONLINE);
  public readonly isOnline = this._isOnline.asReadonly();

  private readonly _showReconnected = signal(false);
  public readonly showReconnected = this._showReconnected.asReadonly();

  private readonly _lastSuccessfulApiCheckAt = signal<number | null>(null);
  public readonly lastSuccessfulApiCheckAt = this._lastSuccessfulApiCheckAt.asReadonly();

  private reconnectedTimeout: ReturnType<typeof setTimeout> | null = null;
  private offlineRecheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly healthUrl = this.buildHealthUrl();

  private wasOffline = false;
  private lastManualCheckAt = 0;
  private checkInProgress = false;
  private appIsActive = true;

  private networkStatusListener: PluginListenerHandle | null = null;
  private appStateListener: PluginListenerHandle | null = null;

  private readonly onlineHandler = (): void => this.zone.run(() => this.onBrowserOnline());
  private readonly offlineHandler = (): void => this.zone.run(() => this.onBrowserOffline());

  constructor() {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    void this.initializeListeners();
    this.syncOfflineRecheckSchedule();
    this.verifyConnection(true);
  }

  public ngOnDestroy(): void {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
    this.clearReconnectedTimeout();
    this.clearOfflineRecheckInterval();
    void this.networkStatusListener?.remove();
    void this.appStateListener?.remove();
  }

  public checkNow(): void {
    this.verifyConnection();
  }

  public verifyConnection(force = false): void {
    if (!force) {
      const now = Date.now();
      if (now - this.lastManualCheckAt < ConnectivityService.MANUAL_CHECK_THROTTLE_MS) {
        return;
      }
      this.lastManualCheckAt = now;
    }

    if (!this.appIsActive || this.checkInProgress) {
      return;
    }

    void this.runConnectivityCheck();
  }

  public canSendOrders(): boolean {
    return this._state() === ConnectivityState.ONLINE;
  }

  private async initializeListeners(): Promise<void> {
    this.appStateListener = await CapApp.addListener('appStateChange', (state) => {
      this.zone.run(() => this.onAppStateChanged(state.isActive));
    });

    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      this.networkStatusListener = await Network.addListener('networkStatusChange', (status) => {
        this.zone.run(() => this.onNetworkStatusChanged(status.connected));
      });
    } catch {
      // Fallback to browser events only if Network plugin is unavailable.
    }
  }

  private onAppStateChanged(isActive: boolean): void {
    this.appIsActive = isActive;
    this.syncOfflineRecheckSchedule();
    if (isActive) {
      this.verifyConnection(true);
    }
  }

  private onNetworkStatusChanged(connected: boolean): void {
    if (!this.appIsActive) {
      return;
    }

    if (!connected) {
      this.onBrowserOffline();
      return;
    }

    this.verifyConnection(true);
  }

  private onBrowserOnline(): void {
    this.verifyConnection(true);
  }

  private onBrowserOffline(): void {
    this.setState(ConnectivityState.OFFLINE);
  }

  private async runConnectivityCheck(): Promise<void> {
    this.checkInProgress = true;

    try {
      const hasInternet = await this.hasInternetConnection();
      if (!hasInternet) {
        this.setState(ConnectivityState.OFFLINE);
        return;
      }

      const isApiReachable = await this.isApiReachable();
      if (isApiReachable) {
        this._lastSuccessfulApiCheckAt.set(Date.now());
        this.setState(ConnectivityState.ONLINE);
      } else {
        this.setState(ConnectivityState.SERVER_UNREACHABLE);
      }
    } finally {
      this.checkInProgress = false;
    }
  }

  private async hasInternetConnection(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return navigator.onLine;
    }

    try {
      const status = await Network.getStatus();
      return status.connected;
    } catch {
      return navigator.onLine;
    }
  }

  private async isApiReachable(): Promise<boolean> {
    return await firstValueFrom(
      this.http.get(this.healthUrl, { responseType: 'text' }).pipe(
        timeout(ConnectivityService.HEALTH_TIMEOUT_MS),
        map(() => true),
        catchError(() => of(false)),
      ),
    );
  }

  private setState(nextState: ConnectivityState): void {
    const previousState = this._state();
    const wasOnlineBefore = previousState === ConnectivityState.ONLINE;

    this._state.set(nextState);
    const isOnlineNow = nextState === ConnectivityState.ONLINE;
    this._isOnline.set(isOnlineNow);
    this.syncOfflineRecheckSchedule();

    if (!isOnlineNow) {
      this.wasOffline = true;
      this._showReconnected.set(false);
      this.clearReconnectedTimeout();
      return;
    }

    if (!wasOnlineBefore) {
      this.onReconnected();
    }
  }

  private buildHealthUrl(): string {
    const apiBase = environment.apiUrl.replace(/\/$/, '');
    return `${apiBase}/health`;
  }

  private onReconnected(): void {
    if (!this.wasOffline) {
      return;
    }

    this.wasOffline = false;
    this._showReconnected.set(true);
    this.clearReconnectedTimeout();

    this.reconnectedTimeout = setTimeout(() => {
      this._showReconnected.set(false);
      this.reconnectedTimeout = null;
    }, 3000);
  }

  private clearReconnectedTimeout(): void {
    if (this.reconnectedTimeout !== null) {
      clearTimeout(this.reconnectedTimeout);
      this.reconnectedTimeout = null;
    }
  }

  private syncOfflineRecheckSchedule(): void {
    if (!this.appIsActive || this._state() === ConnectivityState.ONLINE) {
      this.clearOfflineRecheckInterval();
      return;
    }

    if (this.offlineRecheckInterval !== null) {
      return;
    }

    this.offlineRecheckInterval = setInterval(() => {
      this.zone.run(() => this.verifyConnection(true));
    }, ConnectivityService.OFFLINE_RECHECK_MS);
  }

  private clearOfflineRecheckInterval(): void {
    if (this.offlineRecheckInterval !== null) {
      clearInterval(this.offlineRecheckInterval);
      this.offlineRecheckInterval = null;
    }
  }
}
