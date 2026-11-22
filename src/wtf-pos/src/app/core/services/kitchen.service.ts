import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  KitchenBoardDto,
  KitchenBoardQuery,
  KitchenOrderDto,
  MoveKitchenOrderRequest,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

export class KitchenAccessError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'KitchenAccessError';
  }
}

@Injectable({ providedIn: 'root' })
export class KitchenService {
  public static readonly NO_ACCESS_MESSAGE = 'You do not have access to the kitchen of this branch.';

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/kitchen/orders`;

  public getBoard(query: KitchenBoardQuery = {}): Observable<KitchenBoardDto> {
    let params = new HttpParams();
    if (query.states?.length) {
      params = params.set('states', query.states.join(','));
    }

    if (query.source !== undefined && query.source !== null) {
      params = params.set('source', String(query.source));
    }

    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }

    return this.http
      .get<KitchenBoardDto>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to load the kitchen orders.')));
  }

  public move(id: string, request: MoveKitchenOrderRequest): Observable<KitchenOrderDto> {
    return this.http
      .post<KitchenOrderDto>(`${this.baseUrl}/${id}/state`, request)
      .pipe(catchError((error) => this.handleError(error, 'Unable to update the order.')));
  }

  public markChangeSeen(id: string): Observable<KitchenOrderDto> {
    return this.http
      .post<KitchenOrderDto>(`${this.baseUrl}/${id}/seen`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to mark the change as seen.')));
  }

  public dismiss(id: string): Observable<KitchenOrderDto> {
    return this.http
      .post<KitchenOrderDto>(`${this.baseUrl}/${id}/dismiss`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to dismiss the order.')));
  }

  public clearOld(): Observable<{ cleared: number }> {
    return this.http
      .post<{ cleared: number }>(`${this.baseUrl}/clear-old`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to clear the old orders.')));
  }

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
    const serverMessage = extractHttpErrorMessage(error);
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    if (error.status === 403) {
      return throwError(() => new KitchenAccessError(serverMessage || KitchenService.NO_ACCESS_MESSAGE));
    }

    const message =
      error.status === 0 ? HttpErrorMessages.NetworkUnavailable : serverMessage || fallback;
    return throwError(() => new Error(message));
  }
}
