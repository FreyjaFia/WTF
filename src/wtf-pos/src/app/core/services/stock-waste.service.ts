import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  PagedStockWasteDto,
  PosWasteItemDto,
  RecordStockWasteDto,
  StockWasteDto,
  StockWastePendingCountDto,
  StockWasteQuery,
} from '@shared/models';
import { Observable, Subscription, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';
import { NotificationService } from './notification.service';
import { SignalRService } from './signalr.service';

const REFRESH_DELAY_MS = 400;
const POLL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class StockWasteService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly signalR = inject(SignalRService);
  private readonly notifications = inject(NotificationService);
  private readonly baseUrl = `${environment.apiUrl}/stock-waste`;

  private readonly _pendingCount = signal(0);

  public readonly pendingCount = this._pendingCount.asReadonly();

  private usage = 0;
  private subscriptions: Subscription[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Only review roles call this: the pending count endpoint is limited to them.
  public startPendingCount(): void {
    this.usage += 1;
    if (this.usage > 1) {
      return;
    }

    this.signalR.startNotificationsHub();
    this.subscriptions = [
      this.signalR.stockChanged.subscribe(() => this.scheduleRefresh()),
      this.signalR.notificationsChanged.subscribe(() => this.scheduleRefresh()),
    ];
    this.pollTimer = setInterval(() => this.refreshPendingCount(), POLL_MS);
    this.refreshPendingCount();
  }

  public stopPendingCount(): void {
    if (this.usage === 0) {
      return;
    }

    this.usage -= 1;
    if (this.usage > 0) {
      return;
    }

    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions = [];
    this.signalR.stopNotificationsHub();
    this.clearTimers();
  }

  public refreshPendingCount(): void {
    this.getPendingCount().subscribe({ error: () => undefined });
  }

  public recordWaste(dto: RecordStockWasteDto): Observable<StockWasteDto> {
    const { itemId, ...body } = dto;
    return this.http
      .post<StockWasteDto>(`${environment.apiUrl}/items/${itemId}/stock/waste`, body)
      .pipe(catchError((error) => this.handleError(error, 'Unable to record the waste.')));
  }

  public getWasteItems(): Observable<PosWasteItemDto[]> {
    return this.http
      .get<PosWasteItemDto[]>(`${environment.apiUrl}/pos/waste-items`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the items.')));
  }

  public getWaste(query: StockWasteQuery = {}): Observable<PagedStockWasteDto> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(key, String(value));
      }
    }

    return this.http.get<PagedStockWasteDto>(this.baseUrl, { params }).pipe(
      catchError((error) => this.handleError(error, 'Unable to fetch the waste entries.')),
    );
  }

  public getPendingCount(): Observable<StockWastePendingCountDto> {
    return this.http.get<StockWastePendingCountDto>(`${this.baseUrl}/pending-count`).pipe(
      tap((result) => this._pendingCount.set(result.count)),
      catchError((error) => this.handleError(error, 'Unable to fetch the waste waiting for review.')),
    );
  }

  public confirm(id: string, note?: string | null): Observable<StockWasteDto> {
    return this.http
      .post<StockWasteDto>(`${this.baseUrl}/${id}/confirm`, { note: note || null })
      .pipe(
        tap(() => this.refreshAfterReview()),
        catchError((error) => this.handleError(error, 'Unable to confirm the waste.')),
      );
  }

  public dispute(id: string, note: string): Observable<StockWasteDto> {
    return this.http.post<StockWasteDto>(`${this.baseUrl}/${id}/dispute`, { note }).pipe(
      tap(() => this.refreshAfterReview()),
      catchError((error) => this.handleError(error, 'Unable to dispute the waste.')),
    );
  }

  public reverse(id: string, reason: string): Observable<StockWasteDto> {
    return this.http.post<StockWasteDto>(`${this.baseUrl}/${id}/reverse`, { reason }).pipe(
      tap(() => this.refreshAfterReview()),
      catchError((error) => this.handleError(error, 'Unable to reverse the waste.')),
    );
  }

  public ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.clearTimers();
  }

  // The API marks the entry's review notifications read, so the bell and the pending badge both move.
  private refreshAfterReview(): void {
    if (this.usage > 0) {
      this.refreshPendingCount();
    }
    this.notifications.refreshCounts();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshPendingCount();
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

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
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
