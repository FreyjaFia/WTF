import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { ReportType } from '@shared/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { ReportsService } from './reports.service';

afterEach(() => vi.restoreAllMocks());

describe('ReportsService', () => {
  const base = `${environment.apiUrl}/reports`;
  const range = { fromDate: '2025-01-01', toDate: '2025-01-31' };
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const msgs = ServiceErrorMessages.Report;

  const types: ReportType[] = [
    'daily-close',
    'daily-sales',
    'payments',
    'hourly',
    'product-sales',
    'promotions',
    'staff',
    'customers',
    'voids',
    'customer-links',
    'stock-status',
  ];

  describe('getReport', () => {
    it.each(types)('%s asks its own endpoint with the date range', (type) => {
      const { service, http } = setupHttpService(ReportsService);
      service.getReport(type, range).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/${type}`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('fromDate')).toBe('2025-01-01');
      expect(req.request.params.get('toDate')).toBe('2025-01-31');
      req.flush([]);
    });

    it('returns the rows the API sends', () => {
      const { service, http } = setupHttpService(ReportsService);
      const result = capture(service.getReport<{ paymentMethod: string }>('payments', range));

      http.expectOne((r) => r.url === `${base}/payments`).flush([{ paymentMethod: 'Cash' }]);

      expect(result.value).toEqual([{ paymentMethod: 'Cash' }]);
    });

    it('sends only the filters that are set', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getReport('product-sales', range).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/product-sales`);
      for (const key of ['source', 'groupBy', 'categoryId', 'subCategoryId', 'staffId', 'splitAddOns', 'search', 'sortBy', 'sortDir']) {
        expect(req.request.params.has(key)).toBe(false);
      }
      req.flush([]);
    });

    it('sends every filter that is set, including source 0 (shop orders)', () => {
      const { service, http } = setupHttpService(ReportsService);
      service
        .getReport('daily-sales', {
          ...range,
          source: 0,
          groupBy: 'Month',
          categoryId: 2,
          subCategoryId: 3,
          staffId: 's1',
          splitAddOns: true,
        })
        .subscribe();

      const params = http.expectOne((r) => r.url === `${base}/daily-sales`).request.params;
      expect(params.get('source')).toBe('0');
      expect(params.get('groupBy')).toBe('Month');
      expect(params.get('categoryId')).toBe('2');
      expect(params.get('subCategoryId')).toBe('3');
      expect(params.get('staffId')).toBe('s1');
      expect(params.get('splitAddOns')).toBe('true');
    });

    it('leaves splitAddOns out when it is false', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getReport('product-sales', { ...range, splitAddOns: false }).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/product-sales`);
      expect(req.request.params.has('splitAddOns')).toBe(false);
    });

    it('works without dates for reports that take none', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getReport('stock-status', {}).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/stock-status`);
      expect(req.request.params.keys()).toEqual([]);
      req.flush([]);
    });
  });

  describe('downloads', () => {
    it.each(types)('Excel for %s is a blob with the xlsx Accept header', (type) => {
      const { service, http } = setupHttpService(ReportsService);
      service.downloadReportExcel(type, range).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/${type}`);
      expect(req.request.responseType).toBe('blob');
      expect(req.request.headers.get('Accept')).toBe(xlsx);
      req.flush(new Blob(['x']));
    });

    it.each(types)('PDF for %s is a blob with the pdf Accept header', (type) => {
      const { service, http } = setupHttpService(ReportsService);
      service.downloadReportPdf(type, range).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/${type}`);
      expect(req.request.responseType).toBe('blob');
      expect(req.request.headers.get('Accept')).toBe('application/pdf');
      req.flush(new Blob(['x']));
    });

    it('passes the on-screen search and sort so the file matches the table', () => {
      const { service, http } = setupHttpService(ReportsService);
      service
        .downloadReportExcel('payments', range, { search: '  cash ', sortBy: 'totalAmount', sortDir: 'desc' })
        .subscribe();

      const params = http.expectOne((r) => r.url === `${base}/payments`).request.params;
      expect(params.get('search')).toBe('cash');
      expect(params.get('sortBy')).toBe('totalAmount');
      expect(params.get('sortDir')).toBe('desc');
    });

    it('drops a blank search and a direction without a column', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.downloadReportPdf('payments', range, { search: '   ', sortDir: 'asc' }).subscribe();

      const params = http.expectOne((r) => r.url === `${base}/payments`).request.params;
      expect(params.has('search')).toBe(false);
      expect(params.has('sortBy')).toBe(false);
      expect(params.has('sortDir')).toBe(false);
    });

    it('carries the source on exports too', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.downloadReportExcel('daily-sales', { ...range, source: 1 }).subscribe();
      service.downloadReportPdf('daily-sales', { ...range, source: 0 }).subscribe();

      const requests = http.match((r) => r.url === `${base}/daily-sales`);
      expect(requests.map((r) => r.request.params.get('source'))).toEqual(['1', '0']);
    });

    it('getReport never sends search or sort', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getReport('payments', range).subscribe();

      const params = http.expectOne((r) => r.url === `${base}/payments`).request.params;
      expect(params.has('search')).toBe(false);
      expect(params.has('sortBy')).toBe(false);
    });
  });

  describe('monthly workbook', () => {
    it('status and generate send year and month', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getMonthlyWorkbookStatus(2025, 3).subscribe();
      service.generateMonthlyWorkbook(2025, 3).subscribe();

      const status = http.expectOne((r) => r.url === `${base}/monthly-workbook/status`);
      const generate = http.expectOne((r) => r.url === `${base}/monthly-workbook/generate`);
      expect(status.request.method).toBe('GET');
      expect(status.request.params.get('year')).toBe('2025');
      expect(status.request.params.get('month')).toBe('3');
      expect(generate.request.method).toBe('POST');
      expect(generate.request.body).toBeNull();
      expect(generate.request.params.get('month')).toBe('3');
    });

    it('download requests an xlsx blob', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.downloadMonthlyWorkbook(2025, 3).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/monthly-workbook/download`);
      expect(req.request.responseType).toBe('blob');
      expect(req.request.headers.get('Accept')).toBe(xlsx);
    });
  });

  describe('error mapping', () => {
    it('network loss re-checks connectivity', () => {
      const { service, http, connectivity } = setupHttpService(ReportsService);
      const result = capture(service.getReport('payments', range));

      failNetwork(http.expectOne((r) => r.url === `${base}/payments`));

      expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(connectivity.checkNow).toHaveBeenCalled();
    });

    it('501 means PDF is not available, even with a server message', () => {
      const { service, http } = setupHttpService(ReportsService);
      const result = capture(service.downloadReportPdf('daily-sales', range));

      failWith(http.expectOne((r) => r.url === `${base}/daily-sales`), 501, new Blob([]));

      expect(result.error).toBe(msgs.PdfNotAvailable);
    });

    it('server message beats the fallback', () => {
      const { service, http } = setupHttpService(ReportsService);
      const result = capture(service.getReport('hourly', range));

      failWith(http.expectOne((r) => r.url === `${base}/hourly`), 400, { message: 'Bad range' });

      expect(result.error).toBe('Bad range');
    });

    it('falls back to a message per kind of call', () => {
      const { service, http } = setupHttpService(ReportsService);
      const fetch = capture(service.getReport('voids', range));
      failWith(http.expectOne((r) => r.url === `${base}/voids`), 500);
      const excel = capture(service.downloadReportExcel('payments', range));
      failWith(http.expectOne((r) => r.url === `${base}/payments`), 500, new Blob([]));
      const pdf = capture(service.downloadReportPdf('staff', range));
      failWith(http.expectOne((r) => r.url === `${base}/staff`), 500, new Blob([]));
      const status = capture(service.getMonthlyWorkbookStatus(2025, 1));
      failWith(http.expectOne((r) => r.url === `${base}/monthly-workbook/status`), 500);
      const generate = capture(service.generateMonthlyWorkbook(2025, 1));
      failWith(http.expectOne((r) => r.url === `${base}/monthly-workbook/generate`), 500);
      const download = capture(service.downloadMonthlyWorkbook(2025, 1));
      failWith(http.expectOne((r) => r.url === `${base}/monthly-workbook/download`), 500, new Blob([]));

      expect(fetch.error).toBe(msgs.FetchReportFailed);
      expect(excel.error).toBe(msgs.DownloadExcelFailed);
      expect(pdf.error).toBe(msgs.DownloadPdfFailed);
      expect(status.error).toBe(msgs.FetchMonthlyWorkbookStatusFailed);
      expect(generate.error).toBe(msgs.GenerateMonthlyWorkbookFailed);
      expect(download.error).toBe(msgs.DownloadMonthlyWorkbookFailed);
    });
  });
});
