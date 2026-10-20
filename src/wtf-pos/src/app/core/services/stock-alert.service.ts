import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { StockNotificationListDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

/**
 * The stock alerts saved for the signed-in person (an item fell to a worse level), and how many are unread. The
 * count is shared by the sidebar, the Inventory tabs and the alerts page, so they all agree; it always comes from
 * the server.
 */
@Injectable({ providedIn: 'root' })
export class StockAlertService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/stock-notifications`;
  private readonly _unread = signal(0);

  public readonly unread = this._unread.asReadonly();

  public list(query?: {
    unreadOnly?: boolean;
    page?: number;
    pageSize?: number;
  }): Observable<StockNotificationListDto> {
    let params = new HttpParams();
    if (query?.unreadOnly) {
      params = params.set('unreadOnly', 'true');
    }
    if (query?.page) {
      params = params.set('page', String(query.page));
    }
    if (query?.pageSize) {
      params = params.set('pageSize', String(query.pageSize));
    }

    return this.http.get<StockNotificationListDto>(this.baseUrl, { params }).pipe(
      tap((result) => this._unread.set(result.unreadCount)),
      catchError((error) => this.handleError(error, 'Unable to fetch the stock alerts.')),
    );
  }

  public markRead(ids?: string[]): Observable<number> {
    return this.http
      .post<{ unreadCount: number }>(`${this.baseUrl}/read`, { ids: ids ?? null })
      .pipe(
        map((result) => result.unreadCount),
        tap((unread) => this._unread.set(unread)),
        catchError((error) => this.handleError(error, 'Unable to mark the alerts as read.')),
      );
  }

  /** Reloads the unread count. A failure leaves the old count: a badge must never raise an error. */
  public refresh(): void {
    this.list({ unreadOnly: true, pageSize: 1 }).subscribe({ error: () => undefined });
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
