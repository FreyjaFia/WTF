import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '@environments/environment.development';
import {
  BulkApproveResultDto,
  HeldOrderFilter,
  HeldOrdersDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class HeldOrderService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/orders/review`;

  public getHeldOrders(filter: HeldOrderFilter = {}): Observable<HeldOrdersDto> {
    let params = new HttpParams();
    if (filter.reasonCodes && filter.reasonCodes.length > 0) {
      params = params.set('reasonCodes', filter.reasonCodes.join(','));
    }

    if (filter.cashierId) {
      params = params.set('cashierId', filter.cashierId);
    }

    if (filter.fromDate) {
      params = params.set('fromDate', filter.fromDate);
    }

    if (filter.toDate) {
      params = params.set('toDate', filter.toDate);
    }

    if (filter.agedOnly) {
      params = params.set('agedOnly', 'true');
    }

    return this.http.get<HeldOrdersDto>(this.baseUrl, { params }).pipe(
      catchError((error: HttpErrorResponse) =>
        this.fail(error, 'Unable to fetch the orders waiting for review.'),
      ),
    );
  }

  public bulkApprove(filter: HeldOrderFilter, preview: boolean): Observable<BulkApproveResultDto> {
    return this.http
      .post<BulkApproveResultDto>(`${this.baseUrl}/bulk-approve`, { ...filter, preview })
      .pipe(
        catchError((error: HttpErrorResponse) =>
          this.fail(error, 'Unable to approve the orders. Nothing was changed.'),
        ),
      );
  }

  private fail(error: HttpErrorResponse, fallback: string): Observable<never> {
    console.error(fallback, error);
    return throwError(() => new Error(extractHttpErrorMessage(error) ?? fallback));
  }
}
