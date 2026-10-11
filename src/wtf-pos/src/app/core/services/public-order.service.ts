import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { PagedResultDto, PublicOrderDto, PublicOrderLinkDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** The link is unknown, expired, revoked, or its customer may no longer order. The API gives one answer for all. */
export class PublicLinkInvalidError extends Error {
  public constructor() {
    super(ServiceErrorMessages.PublicOrder.LinkInvalid);
    this.name = 'PublicLinkInvalidError';
  }
}

/**
 * Talks to the anonymous ordering routes. Everything is fetched fresh on every call: nothing here, or in the page
 * that uses it, keeps a local copy of the catalog, so a customer cannot order from an obsolete list.
 */
@Injectable({ providedIn: 'root' })
export class PublicOrderService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/public/order-links`;

  public getLink(token: string): Observable<PublicOrderLinkDto> {
    return this.http
      .get<PublicOrderLinkDto>(this.url(token), this.noCache())
      .pipe(catchError((error) => this.fail(error, ServiceErrorMessages.PublicOrder.LoadFailed)));
  }

  public getOrders(token: string, page = 1, pageSize = 20): Observable<PagedResultDto<PublicOrderDto>> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);

    return this.http
      .get<PagedResultDto<PublicOrderDto>>(`${this.url(token)}/orders`, { ...this.noCache(), params })
      .pipe(
        catchError((error) => this.fail(error, ServiceErrorMessages.PublicOrder.LoadOrdersFailed)),
      );
  }

  public getOrder(token: string, orderId: string): Observable<PublicOrderDto> {
    return this.http
      .get<PublicOrderDto>(`${this.url(token)}/orders/${orderId}`, this.noCache())
      .pipe(
        catchError((error) => this.fail(error, ServiceErrorMessages.PublicOrder.LoadOrdersFailed)),
      );
  }

  private url(token: string): string {
    return `${this.baseUrl}/${encodeURIComponent(token)}`;
  }

  /** Asks the browser not to reuse an earlier response either (the server also sends no-store). */
  private noCache(): { headers: Record<string, string> } {
    return { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } };
  }

  private fail(error: HttpErrorResponse, fallback: string): Observable<never> {
    if (error.status === 404) {
      return throwError(() => new PublicLinkInvalidError());
    }

    if (error.status === 0) {
      return throwError(() => new Error(HttpErrorMessages.NetworkUnavailable));
    }

    if (error.status === 429) {
      return throwError(() => new Error(ServiceErrorMessages.PublicOrder.TooManyRequests));
    }

    console.error('Public ordering request failed:', error);
    return throwError(() => new Error(fallback));
  }
}
