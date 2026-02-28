import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import {
  DailySalesReportQuery,
  DailySalesReportRowDto,
  HourlySalesReportQuery,
  HourlySalesReportRowDto,
  MonthlyReportWorkbookStatusDto,
  PaymentsReportQuery,
  PaymentsReportRowDto,
  ProductSalesReportQuery,
  ProductSalesReportRowDto,
  StaffPerformanceReportQuery,
  StaffPerformanceReportRowDto,
} from '@shared/models';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_FETCH_DAILY_SALES_FAILED = ServiceErrorMessages.Report.FetchDailySalesFailed;
  private static readonly MSG_FETCH_PRODUCT_SALES_FAILED = ServiceErrorMessages.Report.FetchProductSalesFailed;
  private static readonly MSG_FETCH_PAYMENTS_FAILED = ServiceErrorMessages.Report.FetchPaymentsFailed;
  private static readonly MSG_FETCH_HOURLY_SALES_FAILED = ServiceErrorMessages.Report.FetchHourlySalesFailed;
  private static readonly MSG_FETCH_STAFF_PERFORMANCE_FAILED =
    ServiceErrorMessages.Report.FetchStaffPerformanceFailed;
  private static readonly MSG_DOWNLOAD_EXCEL_FAILED = ServiceErrorMessages.Report.DownloadExcelFailed;
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

  public getDailySalesReport(query: DailySalesReportQuery): Observable<DailySalesReportRowDto[]> {
    return this.http
      .get<DailySalesReportRowDto[]>(`${this.baseUrl}/daily-sales`, {
        params: this.buildDailySalesParams(query),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_FETCH_DAILY_SALES_FAILED, error);
        }),
      );
  }

  public getProductSalesReport(query: ProductSalesReportQuery): Observable<ProductSalesReportRowDto[]> {
    return this.http
      .get<ProductSalesReportRowDto[]>(`${this.baseUrl}/product-sales`, {
        params: this.buildProductSalesParams(query),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_FETCH_PRODUCT_SALES_FAILED, error);
        }),
      );
  }

  public getPaymentsReport(query: PaymentsReportQuery): Observable<PaymentsReportRowDto[]> {
    return this.http
      .get<PaymentsReportRowDto[]>(`${this.baseUrl}/payments`, {
        params: this.buildPaymentsParams(query),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_FETCH_PAYMENTS_FAILED, error);
        }),
      );
  }

  public getHourlySalesReport(query: HourlySalesReportQuery): Observable<HourlySalesReportRowDto[]> {
    return this.http
      .get<HourlySalesReportRowDto[]>(`${this.baseUrl}/hourly`, {
        params: this.buildHourlySalesParams(query),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_FETCH_HOURLY_SALES_FAILED, error);
        }),
      );
  }

  public getStaffPerformanceReport(
    query: StaffPerformanceReportQuery,
  ): Observable<StaffPerformanceReportRowDto[]> {
    return this.http
      .get<StaffPerformanceReportRowDto[]>(`${this.baseUrl}/staff`, {
        params: this.buildStaffPerformanceParams(query),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_FETCH_STAFF_PERFORMANCE_FAILED, error);
        }),
      );
  }

  public downloadDailySalesExcel(query: DailySalesReportQuery): Observable<Blob> {
    return this.downloadExcel('/daily-sales', this.buildDailySalesParams(query));
  }

  public downloadProductSalesExcel(query: ProductSalesReportQuery): Observable<Blob> {
    return this.downloadExcel('/product-sales', this.buildProductSalesParams(query));
  }

  public downloadPaymentsExcel(query: PaymentsReportQuery): Observable<Blob> {
    return this.downloadExcel('/payments', this.buildPaymentsParams(query));
  }

  public downloadHourlySalesExcel(query: HourlySalesReportQuery): Observable<Blob> {
    return this.downloadExcel('/hourly', this.buildHourlySalesParams(query));
  }

  public downloadStaffPerformanceExcel(query: StaffPerformanceReportQuery): Observable<Blob> {
    return this.downloadExcel('/staff', this.buildStaffPerformanceParams(query));
  }

  public downloadDailySalesPdf(query: DailySalesReportQuery): Observable<Blob> {
    return this.downloadPdf('/daily-sales', this.buildDailySalesParams(query));
  }

  public downloadProductSalesPdf(query: ProductSalesReportQuery): Observable<Blob> {
    return this.downloadPdf('/product-sales', this.buildProductSalesParams(query));
  }

  public downloadPaymentsPdf(query: PaymentsReportQuery): Observable<Blob> {
    return this.downloadPdf('/payments', this.buildPaymentsParams(query));
  }

  public downloadHourlySalesPdf(query: HourlySalesReportQuery): Observable<Blob> {
    return this.downloadPdf('/hourly', this.buildHourlySalesParams(query));
  }

  public downloadStaffPerformancePdf(query: StaffPerformanceReportQuery): Observable<Blob> {
    return this.downloadPdf('/staff', this.buildStaffPerformanceParams(query));
  }

  public getMonthlyWorkbookStatus(
    year: number,
    month: number,
  ): Observable<MonthlyReportWorkbookStatusDto> {
    return this.http
      .get<MonthlyReportWorkbookStatusDto>(`${this.baseUrl}/monthly-workbook/status`, {
        params: this.buildMonthlyWorkbookParams(year, month),
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
  ): Observable<MonthlyReportWorkbookStatusDto> {
    return this.http
      .post<MonthlyReportWorkbookStatusDto>(`${this.baseUrl}/monthly-workbook/generate`, null, {
        params: this.buildMonthlyWorkbookParams(year, month),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_GENERATE_MONTHLY_WORKBOOK_FAILED, error);
        }),
      );
  }

  public downloadMonthlyWorkbook(year: number, month: number): Observable<Blob> {
    return this.http
      .get(`${this.baseUrl}/monthly-workbook/download`, {
        params: this.buildMonthlyWorkbookParams(year, month),
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

  private downloadExcel(path: string, params: HttpParams): Observable<Blob> {
    return this.http
      .get(`${this.baseUrl}${path}`, {
        params,
        responseType: 'blob',
        headers: new HttpHeaders({
          Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_DOWNLOAD_EXCEL_FAILED, error);
        }),
      );
  }

  private downloadPdf(path: string, params: HttpParams): Observable<Blob> {
    return this.http
      .get(`${this.baseUrl}${path}`, {
        params,
        responseType: 'blob',
        headers: new HttpHeaders({
          Accept: 'application/pdf',
        }),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.buildError(ReportsService.MSG_DOWNLOAD_PDF_FAILED, error);
        }),
      );
  }

  private buildDailySalesParams(query: DailySalesReportQuery): HttpParams {
    let params = this.buildBaseDateRangeParams(query.fromDate, query.toDate);
    if (query.groupBy) {
      params = params.set('groupBy', query.groupBy);
    }

    return params;
  }

  private buildProductSalesParams(query: ProductSalesReportQuery): HttpParams {
    let params = this.buildBaseDateRangeParams(query.fromDate, query.toDate);
    if (query.categoryId !== undefined) {
      params = params.set('categoryId', query.categoryId);
    }

    if (query.subCategoryId !== undefined) {
      params = params.set('subCategoryId', query.subCategoryId);
    }

    return params;
  }

  private buildPaymentsParams(query: PaymentsReportQuery): HttpParams {
    return this.buildBaseDateRangeParams(query.fromDate, query.toDate);
  }

  private buildHourlySalesParams(query: HourlySalesReportQuery): HttpParams {
    return this.buildBaseDateRangeParams(query.fromDate, query.toDate);
  }

  private buildStaffPerformanceParams(query: StaffPerformanceReportQuery): HttpParams {
    let params = this.buildBaseDateRangeParams(query.fromDate, query.toDate);
    if (query.staffId) {
      params = params.set('staffId', query.staffId);
    }

    return params;
  }

  private buildBaseDateRangeParams(fromDate: string, toDate: string): HttpParams {
    return new HttpParams().set('fromDate', fromDate).set('toDate', toDate);
  }

  private buildMonthlyWorkbookParams(year: number, month: number): HttpParams {
    return new HttpParams().set('year', year).set('month', month);
  }

  private buildError(message: string, error: HttpErrorResponse): Observable<never> {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return throwError(() => new Error(ReportsService.MSG_NETWORK_UNAVAILABLE));
    }

    if (error.status === 501) {
      return throwError(() => new Error(ReportsService.MSG_PDF_NOT_AVAILABLE));
    }

    return throwError(() => new Error(message));
  }
}
