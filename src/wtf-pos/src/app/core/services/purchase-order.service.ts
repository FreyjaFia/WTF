import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { PurchaseOrderDto, PurchaseOrderFieldsDto, PurchaseOrderSummaryDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class PurchaseOrderService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/purchase-orders`;

  public getOrders(query?: {
    status?: number | null;
    supplierId?: string | null;
    openOnly?: boolean;
  }): Observable<PurchaseOrderSummaryDto[]> {
    let params = new HttpParams();
    if (query?.status) {
      params = params.set('status', query.status);
    }

    if (query?.supplierId) {
      params = params.set('supplierId', query.supplierId);
    }

    if (query?.openOnly) {
      params = params.set('openOnly', true);
    }

    return this.http
      .get<PurchaseOrderSummaryDto[]>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the purchase orders.')));
  }

  public getOrder(id: string): Observable<PurchaseOrderDto> {
    return this.http
      .get<PurchaseOrderDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the purchase order.')));
  }

  public createOrder(fields: PurchaseOrderFieldsDto): Observable<PurchaseOrderDto> {
    return this.http
      .post<PurchaseOrderDto>(this.baseUrl, fields)
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the purchase order.')));
  }

  public createFromReorder(supplierId: string): Observable<PurchaseOrderDto> {
    return this.http
      .post<PurchaseOrderDto>(`${this.baseUrl}/from-reorder`, { supplierId })
      .pipe(catchError((error) => this.handleError(error, 'Unable to draft the purchase order.')));
  }

  public updateOrder(id: string, fields: PurchaseOrderFieldsDto): Observable<PurchaseOrderDto> {
    return this.http
      .put<PurchaseOrderDto>(`${this.baseUrl}/${id}`, fields)
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the purchase order.')));
  }

  public sendOrder(id: string): Observable<PurchaseOrderDto> {
    return this.act(id, 'send', 'Unable to send the purchase order.');
  }

  public cancelOrder(id: string): Observable<PurchaseOrderDto> {
    return this.act(id, 'cancel', 'Unable to cancel the purchase order.');
  }

  public closeOrder(id: string): Observable<PurchaseOrderDto> {
    return this.act(id, 'close', 'Unable to close the purchase order.');
  }

  private act(id: string, action: string, fallback: string): Observable<PurchaseOrderDto> {
    return this.http
      .post<PurchaseOrderDto>(`${this.baseUrl}/${id}/${action}`, {})
      .pipe(catchError((error) => this.handleError(error, fallback)));
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
