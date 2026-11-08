import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { RecordStockReceiptDto, StockReceiptDto, StockReceiptSummaryDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class StockReceiptService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/stock-receipts`;

  public getReceipts(query?: {
    supplierId?: string | null;
    search?: string | null;
  }): Observable<StockReceiptSummaryDto[]> {
    let params = new HttpParams();
    if (query?.supplierId) {
      params = params.set('supplierId', query.supplierId);
    }

    if (query?.search) {
      params = params.set('search', query.search);
    }

    return this.http
      .get<StockReceiptSummaryDto[]>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the receipts.')));
  }

  public getReceipt(id: string): Observable<StockReceiptDto> {
    return this.http
      .get<StockReceiptDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the receipt.')));
  }

  public recordReceipt(payload: RecordStockReceiptDto): Observable<StockReceiptDto> {
    return this.http
      .post<StockReceiptDto>(this.baseUrl, payload)
      .pipe(catchError((error) => this.handleError(error, 'Unable to record the receipt.')));
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
