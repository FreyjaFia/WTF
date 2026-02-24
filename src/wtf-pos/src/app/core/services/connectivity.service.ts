import { HttpClient } from '@angular/common/http';
import { inject, Injectable, NgZone, OnDestroy, signal } from '@angular/core';
import { environment } from '@environments/environment.development';

@Injectable({ providedIn: 'root' })
export class ConnectivityService implements OnDestroy {
  private static readonly MANUAL_PING_THROTTLE_MS = 3000;

  private readonly http = inject(HttpClient);
  private readonly zone = inject(NgZone);

  private readonly _isOnline = signal(navigator.onLine);
  public readonly isOnline = this._isOnline.asReadonly();

  private readonly _showReconnected = signal(false);
  public readonly showReconnected = this._showReconnected.asReadonly();

  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectedTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly healthUrl = `${environment.apiUrl}/ping`;
  private wasOffline = false;
  private lastManualPingAt = 0;

  private readonly onlineHandler = (): void => this.zone.run(() => this.onBrowserOnline());
  private readonly offlineHandler = (): void => this.zone.run(() => this.onBrowserOffline());

  constructor() {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    this.startHealthCheck();
  }

  public ngOnDestroy(): void {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
    this.stopHealthCheck();
    this.clearReconnectedTimeout();
  }

  public checkNow(): void {
    const now = Date.now();

    if (now - this.lastManualPingAt < ConnectivityService.MANUAL_PING_THROTTLE_MS) {
      return;
    }

    this.lastManualPingAt = now;
    this.ping();
  }

  private onBrowserOnline(): void {
    // Browser says we're online, but verify with a real ping
    this.ping();
  }

  private onBrowserOffline(): void {
    this.wasOffline = true;
    this._showReconnected.set(false);
    this.clearReconnectedTimeout();
    this._isOnline.set(false);
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

  private startHealthCheck(): void {
    // Ping every 30 seconds to detect silent connectivity loss
    this.healthCheckInterval = setInterval(() => this.ping(), 30_000);

    // Also do an immediate check on startup
    this.ping();
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval !== null) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private ping(): void {
    this.http.get(this.healthUrl, { responseType: 'text' }).subscribe({
      next: () => {
        const wasOfflineBefore = !this._isOnline();
        this._isOnline.set(true);
        if (wasOfflineBefore) {
          this.onReconnected();
        }
      },
      error: () => {
        if (this._isOnline()) {
          this.wasOffline = true;
        }
        this._isOnline.set(false);
      },
    });
  }
}
