import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { environment } from '@environments/environment.development';
import {
  accessUntil,
  daysLeft,
  effectiveNow,
  leaseTooOld,
  SubscriptionWarning,
  warningLevel,
} from '@shared/calculations/subscription-rules';
import { LeasePayload, SubscriptionDto, TenantInvoiceDto } from '@shared/models/subscription.models';
import { Observable } from 'rxjs';

interface StoredLease {
  lease: string;
}

export type DeviceAccess = 'ok' | 'locked' | 'needsOnline';

@Injectable({ providedIn: 'root' })
export class SubscriptionService implements OnDestroy {
  public static readonly STORAGE_KEY = 'wtf-subscription-lease';
  public static readonly SEEN_KEY = 'wtf-subscription-latest-seen';

  private static readonly SHOP_TIME_ZONE = 'Asia/Manila';
  private static readonly TICK_MS = 60 * 1000;

  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/subscription`;

  private readonly _lease = signal<LeasePayload | null>(null);
  private readonly _managedByServer = signal(false);
  private readonly _now = signal(Date.now());
  private timers: ReturnType<typeof setInterval>[] = [];
  private started = false;
  private refreshedOnDay: string | null = null;
  private readonly onlineHandler = (): void => this.refresh();

  public readonly leasePayload = this._lease.asReadonly();

  public readonly now = computed(() => effectiveNow(new Date(this._now()), this.readLatestSeen()));

  public readonly warning = computed<SubscriptionWarning>(() => {
    const lease = this._lease();

    if (!lease) {
      return 'none';
    }

    return warningLevel(new Date(lease.periodEnd), lease.graceDays, this.now());
  });

  public readonly daysLeft = computed(() => {
    const lease = this._lease();

    return lease ? daysLeft(new Date(lease.periodEnd), this.now()) : 0;
  });

  public readonly periodEnd = computed(() => {
    const lease = this._lease();

    return lease ? new Date(lease.periodEnd) : null;
  });

  public readonly accessUntil = computed(() => {
    const lease = this._lease();

    return lease ? accessUntil(new Date(lease.periodEnd), lease.graceDays) : null;
  });

  public readonly access = computed<DeviceAccess>(() => {
    const lease = this._lease();

    if (!lease) {
      return 'ok';
    }

    if (this.warning() === 'locked') {
      return 'locked';
    }

    return leaseTooOld(new Date(lease.issuedAt), this.now(), lease.maxAgeDays) ? 'needsOnline' : 'ok';
  });

  public constructor() {
    void this.restore();
  }

  public start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.refresh();
    this.timers.push(
      setInterval(() => {
        this._now.set(Date.now());

        if (this.refreshedOnDay !== this.shopDay()) {
          this.refresh();
        }
      }, SubscriptionService.TICK_MS),
    );
    window.addEventListener('online', this.onlineHandler);
  }

  public ngOnDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
    window.removeEventListener('online', this.onlineHandler);
  }

  public lastOnline(): string | null {
    return this.readLatestSeen()?.toISOString() ?? null;
  }

  public refresh(): void {
    this.refreshedOnDay = this.shopDay();
    this.http.get<SubscriptionDto>(this.baseUrl).subscribe({
      next: (dto) => void this.accept(dto),
      error: () => undefined,
    });
  }

  public getInvoices(): Observable<TenantInvoiceDto[]> {
    return this.http.get<TenantInvoiceDto[]>(`${this.baseUrl}/invoices`);
  }

  public clear(): void {
    localStorage.removeItem(SubscriptionService.STORAGE_KEY);
    this._lease.set(null);
  }

  private async accept(dto: SubscriptionDto): Promise<void> {
    this._managedByServer.set(dto.managed);
    this.rememberSeen(new Date(dto.serverTime));

    if (!dto.managed || !dto.lease) {
      this.clear();
      return;
    }

    const payload = await this.verify(dto.lease);

    if (!payload) {
      return;
    }

    const stored: StoredLease = { lease: dto.lease };
    localStorage.setItem(SubscriptionService.STORAGE_KEY, JSON.stringify(stored));
    this._lease.set(payload);
  }

  private async restore(): Promise<void> {
    try {
      const raw = localStorage.getItem(SubscriptionService.STORAGE_KEY);

      if (!raw) {
        return;
      }

      const payload = await this.verify((JSON.parse(raw) as StoredLease).lease);

      if (payload) {
        this._lease.set(payload);
      } else {
        localStorage.removeItem(SubscriptionService.STORAGE_KEY);
      }
    } catch {
      localStorage.removeItem(SubscriptionService.STORAGE_KEY);
    }
  }

  // The lease is "payload.signature" (base64url); the signature is empty while the API has no signing key. With a public key built into the app the signature is checked on the
  // device, so editing the stored lease (or the device clock) cannot buy more days.
  private async verify(lease: string): Promise<LeasePayload | null> {
    const [body, signature] = lease.split('.');

    if (!body || (environment.leasePublicKey && !signature)) {
      return null;
    }

    try {
      if (environment.leasePublicKey) {
        const key = await crypto.subtle.importKey(
          'spki',
          this.fromBase64(environment.leasePublicKey),
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        );
        const valid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          this.fromBase64(signature.replace(/-/g, '+').replace(/_/g, '/')),
          new TextEncoder().encode(body),
        );

        if (!valid) {
          return null;
        }
      }

      const json = new TextDecoder().decode(this.fromBase64(body.replace(/-/g, '+').replace(/_/g, '/')));

      return JSON.parse(json) as LeasePayload;
    } catch {
      return null;
    }
  }

  private fromBase64(value: string): Uint8Array<ArrayBuffer> {
    const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  private shopDay(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: SubscriptionService.SHOP_TIME_ZONE }).format(new Date());
  }

  private readLatestSeen(): Date | null {
    const raw = localStorage.getItem(SubscriptionService.SEEN_KEY);
    const time = raw ? Date.parse(raw) : NaN;

    return Number.isNaN(time) ? null : new Date(time);
  }

  private rememberSeen(serverTime: Date): void {
    const current = this.readLatestSeen();
    const latest = current && current > serverTime ? current : serverTime;
    localStorage.setItem(SubscriptionService.SEEN_KEY, latest.toISOString());
    this._now.set(Date.now());
  }
}
