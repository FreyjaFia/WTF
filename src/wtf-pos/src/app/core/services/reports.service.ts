import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import {
  MonthlyReportWorkbookStatusDto,
  ReportExportOptions,
  ReportQuery,
  ReportSource,
  ReportType,
} from '@shared/models';
import { Observable, catchError, throwError } from 'rxjs';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_FETCH_REPORT_FAILED = ServiceErrorMessages.Report.FetchReportFailed;
  private static readonly MSG_DOWNLOAD_EXCEL_FAILED =
    ServiceErrorMessages.Report.DownloadExcelFailed;
  private static readonly MSG_DOWNLOAD_PDF_FAILED = ServiceErrorMessages.Report.DownloadPdfFailed;
  private static readonly MSG_GENERATE_MONTHLY_WORKBOOK_FAILED =
    ServiceErrorMessages.Report.GenerateMonthlyWorkbookFailed;
  private static readonly MSG_DOWNLOAD_MONTHLY_WORKBOOK_FAILED =
    ServiceErrorMessages.Report.DownloadMonthlyWorkbookFailed;
  private static readonly MSG_FETCH_MONTHLY_WORKBOOK_STATUS_FAILED =
    ServiceErrorMessages.Report.FetchMonthlyWorkbookStatusFailed;
  private static readonly MSG_PDF_NOT_AVAILABLE = ServiceErrorMessages.Report.PdfNotAvailable;

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/reports`;

  public getReport<T>(type: ReportType, query: ReportQuery): Observable<T[]> {
    return this.http
      .get<T[]>(`${this.baseUrl}/${type}`, { params: this.buildParams(query) })
      .pipe(
        catchError((error: HttpErrorResponse) =>
          this.buildError(ReportsService.MSG_FETCH_REPORT_FAILED, error),
        ),
      );
  }

  public downloadReportExcel(
    type: ReportType,
    query: ReportQuery,
    options: ReportExportOptions = {},
  ): Observable<Blob> {
    return this.download(
      type,
      this.buildParams(query, options),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ReportsService.MSG_DOWNLOAD_EXCEL_FAILED,
    );
  }

  public downloadReportPdf(
    type: ReportType,
    query: ReportQuery,
    options: ReportExportOptions = {},
  ): Observable<Blob> {
    return this.download(
      type,
      this.buildParams(query, options),
      'application/pdf',
      ReportsService.MSG_DOWNLOAD_PDF_FAILED,
    );
  }

  public getMonthlyWorkbookStatus(
    year: number,
    month: number,
    source: ReportSource | null = null,
  ): Observable<MonthlyReportWorkbookStatusDto> {
    return this.http
      .get<MonthlyReportWorkbookStatusDto>(`${this.baseUrl}/monthly-workbook/status`, {
        params: this.buildMonthlyWorkbookParams(year, month, source),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_FETCH_MONTHLY_WORKBOOK_STATUS_FAILED, error);
        }),
      );
  }

  public generateMonthlyWorkbook(
    year: number,
    month: number,
    source: ReportSource | null = null,
  ): Observable<MonthlyReportWorkbookStatusDto> {
    return this.http
      .post<MonthlyReportWorkbookStatusDto>(`${this.baseUrl}/monthly-workbook/generate`, null, {
        params: this.buildMonthlyWorkbookParams(year, month, source),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_GENERATE_MONTHLY_WORKBOOK_FAILED, error);
        }),
      );
  }

  public downloadMonthlyWorkbook(
    year: number,
    month: number,
    source: ReportSource | null = null,
  ): Observable<Blob> {
    return this.http
      .get(`${this.baseUrl}/monthly-workbook/download`, {
        params: this.buildMonthlyWorkbookParams(year, month, source),
        responseType: 'blob',
        headers: new HttpHeaders({
          Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_DOWNLOAD_MONTHLY_WORKBOOK_FAILED, error);
        }),
      );
  }

  private download(
    type: ReportType,
    params: HttpParams,
    accept: string,
    failureMessage: string,
  ): Observable<Blob> {
    return this.http
      .get(`${this.baseUrl}/${type}`, {
        params,
        responseType: 'blob',
        headers: new HttpHeaders({ Accept: accept }),
      })
      .pipe(catchError((error: HttpErrorResponse) => this.buildError(failureMessage, error)));
  }

  private buildParams(query: ReportQuery, options: ReportExportOptions = {}): HttpParams {
    const values: Record<string, string | number | boolean | undefined> = {
      fromDate: query.fromDate,
      toDate: query.toDate,
      source: query.source,
      groupBy: query.wasteGroupBy ?? query.groupBy,
      itemId: query.itemId,
      wasteReasonId: query.wasteReasonId,
      categoryId: query.categoryId,
      subCategoryId: query.subCategoryId,
      staffId: query.staffId,
      splitAddOns: query.splitAddOns ? true : undefined,
      search: options.search?.trim() ? options.search.trim() : undefined,
      sortBy: options.sortBy,
      sortDir: options.sortBy ? options.sortDir : undefined,
    };

    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) {
        params = params.set(key, value);
      }
    }

    return params;
  }

  private buildMonthlyWorkbookParams(
    year: number,
    month: number,
    source: ReportSource | null,
  ): HttpParams {
    const params = new HttpParams().set('year', year).set('month', month);
    return source === null ? params : params.set('source', source);
  }

  private buildError(message: string, error: HttpErrorResponse): Observable<never> {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return throwError(() => new Error(ReportsService.MSG_NETWORK_UNAVAILABLE));
    }

    if (error.status === 501) {
      return throwError(() => new Error(ReportsService.MSG_PDF_NOT_AVAILABLE));
    }

    const serverMessage = extractHttpErrorMessage(error);
    if (serverMessage) {
      return throwError(() => new Error(serverMessage));
    }

    return throwError(() => new Error(message));
  }
}
