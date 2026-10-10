import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import { AuditLogDto, AuditLogQuery, PagedResultDto } from '@shared/models';
import { Observable, catchError, throwError } from 'rxjs';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_FETCH_FAILED = 'Failed to fetch audit logs. Please try again later.';
  private static readonly MSG_FETCH_ACTIONS_FAILED =
    'Failed to fetch audit log actions. Please try again later.';
  private static readonly MSG_DOWNLOAD_EXCEL_FAILED =
    'Failed to download the Excel file. Please try again later.';
  private static readonly MSG_DOWNLOAD_PDF_FAILED =
    'Failed to download the PDF file. Please try again later.';

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/audit-logs`;

  public getAuditLogs(query?: AuditLogQuery): Observable<PagedResultDto<AuditLogDto>> {
    return this.http
      .get<PagedResultDto<AuditLogDto>>(this.baseUrl, { params: this.buildParams(query) })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error fetching audit logs:', error);
          return this.buildError(AuditLogService.MSG_FETCH_FAILED, error);
        }),
      );
  }

  public getAuditActions(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/actions`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching audit log actions:', error);
        return this.buildError(AuditLogService.MSG_FETCH_ACTIONS_FAILED, error);
      }),
    );
  }

  public downloadAuditLogsExcel(query?: AuditLogQuery): Observable<Blob> {
    return this.download(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      AuditLogService.MSG_DOWNLOAD_EXCEL_FAILED,
      query,
    );
  }

  public downloadAuditLogsPdf(query?: AuditLogQuery): Observable<Blob> {
    return this.download('application/pdf', AuditLogService.MSG_DOWNLOAD_PDF_FAILED, query);
  }

  private download(accept: string, failureMessage: string, query?: AuditLogQuery): Observable<Blob> {
    return this.http
      .get(this.baseUrl, {
        params: this.buildParams(query),
        responseType: 'blob',
        headers: new HttpHeaders({ Accept: accept }),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error downloading audit logs:', error);
          return this.buildError(failureMessage, error);
        }),
      );
  }

  private buildParams(query?: AuditLogQuery): HttpParams {
    let params = new HttpParams();
    if (!query) {
      return params;
    }

    Object.entries(query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          params = params.append(key, String(item));
        });
        return;
      }

      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });

    return params;
  }

  private buildError(message: string, error: HttpErrorResponse): Observable<never> {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return throwError(() => new Error(AuditLogService.MSG_NETWORK_UNAVAILABLE));
    }

    const serverMessage = extractHttpErrorMessage(error);
    if (serverMessage) {
      return throwError(() => new Error(serverMessage));
    }

    return throwError(() => new Error(message));
  }
}
