import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import { AuditLogDto, AuditLogQuery, PagedResultDto } from '@shared/models';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_FETCH_FAILED = 'Failed to fetch audit logs. Please try again later.';

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/audit-logs`;

  public getAuditLogs(query?: AuditLogQuery): Observable<PagedResultDto<AuditLogDto>> {
    let params = new HttpParams();
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params = params.set(key, String(value));
        }
      });
    }

    return this.http.get<PagedResultDto<AuditLogDto>>(this.baseUrl, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching audit logs:', error);
        if (error.status === 0) {
          this.connectivity.checkNow();
          return throwError(() => new Error(AuditLogService.MSG_NETWORK_UNAVAILABLE));
        }

        return throwError(() => new Error(AuditLogService.MSG_FETCH_FAILED));
      }),
    );
  }
}
