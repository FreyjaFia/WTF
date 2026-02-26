import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import { type DashboardDto, type DateRangeSelection } from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_LOAD_DASHBOARD_FAILED =
    ServiceErrorMessages.Dashboard.LoadDashboardFailed;

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
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
        if (error.status === 0) {
          this.connectivity.checkNow();
          return throwError(() => new Error(DashboardService.MSG_NETWORK_UNAVAILABLE));
        }

        return throwError(() => new Error(DashboardService.MSG_LOAD_DASHBOARD_FAILED));
      }),
    );
  }
}
