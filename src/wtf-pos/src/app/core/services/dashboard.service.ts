import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '@environments/environment.development';
import { type DashboardDto, type DateRangeSelection } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/dashboard`;

  public getDashboard(range?: DateRangeSelection): Observable<DashboardDto> {
    let params = new HttpParams();

    if (range) {
      params = params.set('preset', range.preset);

      if (range.preset === 'custom' && range.startDate && range.endDate) {
        params = params.set('startDate', range.startDate);
        params = params.set('endDate', range.endDate);
      }
    }

    return this.http.get<DashboardDto>(this.baseUrl, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching dashboard:', error);

        const errorMessage =
          error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to load dashboard. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }
}
