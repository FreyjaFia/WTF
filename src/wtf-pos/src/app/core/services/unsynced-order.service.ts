import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  PagedResultDto,
  UnsyncedOrderDetailDto,
  UnsyncedOrderDto,
  UnsyncedOrderQuery,
  UnsyncedOrderRetryResultDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class UnsyncedOrderService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/orders/unsynced`;

  public getUnsyncedOrders(query?: UnsyncedOrderQuery): Observable<PagedResultDto<UnsyncedOrderDto>> {
    let params = new HttpParams();
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });

    return this.http
      .get<PagedResultDto<UnsyncedOrderDto>>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the unsynced orders.')));
  }

  public getUnsyncedOrder(id: string): Observable<UnsyncedOrderDetailDto> {
    return this.http
      .get<UnsyncedOrderDetailDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the unsynced order.')));
  }

  public retry(id: string): Observable<UnsyncedOrderRetryResultDto> {
    return this.http
      .post<UnsyncedOrderRetryResultDto>(`${this.baseUrl}/${id}/retry`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to retry the order.')));
  }

  public saveAsNote(id: string): Observable<UnsyncedOrderDetailDto> {
    return this.http
      .post<UnsyncedOrderDetailDto>(`${this.baseUrl}/${id}/note-only`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the order as a note.')));
  }

  public discard(id: string, reason: string): Observable<UnsyncedOrderDetailDto> {
    return this.http
      .post<UnsyncedOrderDetailDto>(`${this.baseUrl}/${id}/discard`, { reason })
      .pipe(catchError((error) => this.handleError(error, 'Unable to discard the order.')));
  }

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
    const serverMessage = extractHttpErrorMessage(error);
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    const message =
      error.status === 0 ? HttpErrorMessages.NetworkUnavailable : serverMessage || fallback;
    return throwError(() => new Error(message));
  }
}
