import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import { CreateStockTransferDto, PagedResultDto, StockTransferDto, StockTransferSummaryDto } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';
import { PagedQuery, pagedParams } from './paged-params';

@Injectable({ providedIn: 'root' })
export class StockTransferService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/stock-transfers`;

  public getTransfersPaged(query: PagedQuery): Observable<PagedResultDto<StockTransferSummaryDto>> {
    return this.http
      .get<PagedResultDto<StockTransferSummaryDto>>(`${this.baseUrl}/paged`, { params: pagedParams(query) })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the transfers.')));
  }

  public getTransfer(id: string): Observable<StockTransferDto> {
    return this.http
      .get<StockTransferDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the transfer.')));
  }

  public createTransfer(dto: CreateStockTransferDto): Observable<StockTransferDto> {
    return this.http
      .post<StockTransferDto>(this.baseUrl, dto)
      .pipe(catchError((error) => this.handleError(error, 'Unable to move the stock.')));
  }

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
    const serverMessage = extractHttpErrorMessage(error);
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    const message = error.status === 0 ? HttpErrorMessages.NetworkUnavailable : serverMessage || fallback;
    return throwError(() => new Error(message));
  }
}
