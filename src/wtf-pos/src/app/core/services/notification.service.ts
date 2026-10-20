import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { NotificationCountsDto, NotificationListDto } from '@shared/models';
import { Observable, Subject, Subscription, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';
import { SignalRService } from './signalr.service';

/** A burst of changes is turned into one refresh. */
const REFRESH_DELAY_MS = 300;
/** The live connection is only a convenience, so the counts are also refreshed now and then. */
const POLL_MS = 60_000;

/**
 * The signed-in person's notifications: every kind of event the app wants them to know about (stock alerts today).
 * The unread counts are shared by the bell, the sidebar and the pages, so they all agree; they always come from the
 * server. A live connection says "something changed" and the counts are loaded again, so a new notification shows
 * without a refresh.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly signalR = inject(SignalRService);
  private readonly baseUrl = `${environment.apiUrl}/notifications`;

  private readonly _unread = signal(0);
  private readonly _unreadByKind = signal<Record<string, number>>({});
  private readonly changed$ = new Subject<void>();

  /** What the bell badge shows: unread across every kind. */
  public readonly unread = this._unread.asReadonly();
  public readonly unreadByKind = this._unreadByKind.asReadonly();
  /** Fires after the counts were reloaded because something changed, so an open list can reload too. */
  public readonly changed: Observable<void> = this.changed$.asObservable();

  private usage = 0;
  private subscription: Subscription | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Starts listening. Every screen that shows notification state calls this, and stops when it goes away. */
  public start(): void {
    this.usage += 1;
    if (this.usage > 1) {
      return;
    }

    this.signalR.startNotificationsHub();
    this.subscription = this.signalR.notificationsChanged.subscribe(() => this.scheduleRefresh());
    this.pollTimer = setInterval(() => this.refreshCounts(), POLL_MS);
    this.refreshCounts();
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

  public list(query?: {
    kind?: string | null;
    unreadOnly?: boolean;
    page?: number;
    pageSize?: number;
  }): Observable<NotificationListDto> {
    let params = new HttpParams();
    if (query?.kind) {
      params = params.set('kind', query.kind);
    }
    if (query?.unreadOnly) {
      params = params.set('unreadOnly', 'true');
    }
    if (query?.page) {
      params = params.set('page', String(query.page));
    }
    if (query?.pageSize) {
      params = params.set('pageSize', String(query.pageSize));
    }

    return this.http.get<NotificationListDto>(this.baseUrl, { params }).pipe(
      tap((result) => this.setCounts(result)),
      catchError((error) => this.handleError(error, 'Unable to fetch the notifications.')),
    );
  }

  public markRead(target?: { ids?: string[]; kind?: string }): Observable<NotificationCountsDto> {
    return this.http
      .post<NotificationCountsDto>(`${this.baseUrl}/read`, {
        ids: target?.ids ?? null,
        kind: target?.kind ?? null,
      })
      .pipe(
        tap((counts) => this.setCounts(counts)),
        catchError((error) => this.handleError(error, 'Unable to mark the notifications as read.')),
      );
  }

  /** Reloads the counts. A failure leaves the old ones: a badge must never raise an error. */
  public refreshCounts(): void {
    this.http.get<NotificationCountsDto>(`${this.baseUrl}/counts`).subscribe({
      next: (counts) => this.setCounts(counts),
      error: () => undefined,
    });
  }

  public ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.clearTimers();
    this.changed$.complete();
  }

  private setCounts(counts: NotificationCountsDto): void {
    this._unread.set(counts.unreadCount);
    this._unreadByKind.set(counts.unreadByKind ?? {});
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshCounts();
      this.changed$.next();
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
