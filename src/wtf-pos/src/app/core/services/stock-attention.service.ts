import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { StockAttentionDto, StockAttentionItemDto } from '@shared/models';
import { Observable, Subscription, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';
import { SignalRService } from './signalr.service';

/** A burst of sales is turned into one refresh. */
const REFRESH_DELAY_MS = 400;
/** The live connection is only a convenience, so the list is also refreshed now and then. */
const POLL_MS = 60_000;

/**
 * What needs stock people's attention right now: the items that are low, critical or out, worst first. It is the
 * current state of the shelf (not a list of events), shared by the Needs Attention page, the sidebar, the dock and the
 * Inventory tabs so they all agree. The server says when any item's stock changed and the list is loaded again.
 */
@Injectable({ providedIn: 'root' })
export class StockAttentionService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly signalR = inject(SignalRService);
  private readonly baseUrl = `${environment.apiUrl}/items/attention`;

  private readonly _data = signal<StockAttentionDto | null>(null);

  public readonly items = computed<StockAttentionItemDto[]>(() => this._data()?.items ?? []);
  public readonly outCount = computed(() => this._data()?.outCount ?? 0);
  public readonly criticalCount = computed(() => this._data()?.criticalCount ?? 0);
  public readonly warningCount = computed(() => this._data()?.warningCount ?? 0);
  /** What the badges show: every item that needs attention. */
  public readonly count = computed(() => this._data()?.totalCount ?? 0);
  /** Out of stock or critical: the badge turns red for these and amber when it is only low. */
  public readonly urgentCount = computed(() => this.outCount() + this.criticalCount());
  public readonly hasLoaded = computed(() => this._data() !== null);

  private usage = 0;
  private subscription: Subscription | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  public start(): void {
    this.usage += 1;
    if (this.usage > 1) {
      return;
    }

    this.signalR.startNotificationsHub();
    this.subscription = this.signalR.stockChanged.subscribe(() => this.scheduleRefresh());
    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
    this.refresh();
  }

  public stop(): void {
    if (this.usage === 0) {
      return;
    }

    this.usage -= 1;
    if (this.usage > 0) {
      return;
    }

    this.subscription?.unsubscribe();
    this.subscription = null;
    this.signalR.stopNotificationsHub();
    this.clearTimers();
  }

  public load(): Observable<StockAttentionDto> {
    return this.http.get<StockAttentionDto>(this.baseUrl).pipe(
      tap((result) => this._data.set(result)),
      catchError((error) => this.handleError(error, 'Unable to fetch the items that need attention.')),
    );
  }

  /** Reloads quietly. A failure leaves what is shown: a badge must never raise an error. */
  public refresh(): void {
    this.load().subscribe({ error: () => undefined });
  }

  public ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.clearTimers();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, REFRESH_DELAY_MS);
  }

  private clearTimers(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private handleError(error: HttpErrorResponse, fallback: string) {
    const serverMessage = extractHttpErrorMessage(error);
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    const message =
      error.status === 0
        ? 'Network unavailable. Please check your connection.'
        : serverMessage || fallback;
    return throwError(() => new Error(message));
  }
}
