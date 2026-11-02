import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  StartStockCountDto,
  StockCountDto,
  StockCountEntryDto,
  StockCountStatus,
  StockCountSummaryDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class StockCountService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/stock-counts`;

  public getCounts(status?: StockCountStatus): Observable<StockCountSummaryDto[]> {
    const query = status ? `?status=${status}` : '';
    return this.http
      .get<StockCountSummaryDto[]>(`${this.baseUrl}${query}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the stock counts.')));
  }

  public getCount(id: string): Observable<StockCountDto> {
    return this.http
      .get<StockCountDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the stock count.')));
  }

  public startCount(dto: StartStockCountDto): Observable<StockCountDto> {
    return this.http
      .post<StockCountDto>(this.baseUrl, dto)
      .pipe(catchError((error) => this.handleError(error, 'Unable to start the stock count.')));
  }

  public saveLines(id: string, lines: StockCountEntryDto[]): Observable<StockCountDto> {
    return this.http
      .put<StockCountDto>(`${this.baseUrl}/${id}/lines`, { lines })
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the counted numbers.')));
  }

  public postCount(id: string): Observable<StockCountDto> {
    return this.http
      .post<StockCountDto>(`${this.baseUrl}/${id}/post`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to post the stock count.')));
  }

  public cancelCount(id: string): Observable<StockCountDto> {
    return this.http
      .post<StockCountDto>(`${this.baseUrl}/${id}/cancel`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to cancel the stock count.')));
  }

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
    const serverMessage = extractHttpErrorMessage(error);
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    const message =
      error.status === 0
        ? HttpErrorMessages.NetworkUnavailable
        : serverMessage || fallback;
    return throwError(() => new Error(message));
  }
}
