import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { ReportsService } from './reports.service';

afterEach(() => vi.restoreAllMocks());

describe('ReportsService', () => {
  const base = `${environment.apiUrl}/reports`;
  const range = { fromDate: '2025-01-01', toDate: '2025-01-31' };
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const msgs = ServiceErrorMessages.Report;

  describe('JSON reports', () => {
    it('daily sales adds groupBy only when provided', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getDailySalesReport({ ...range, groupBy: 'month' } as never).subscribe();
      service.getDailySalesReport(range as never).subscribe();

      const requests = http.match((r) => r.url === `${base}/daily-sales`);
      expect(requests).toHaveLength(2);
      expect(requests[0].request.params.get('fromDate')).toBe('2025-01-01');
      expect(requests[0].request.params.get('toDate')).toBe('2025-01-31');
      expect(requests[0].request.params.get('groupBy')).toBe('month');
      expect(requests[1].request.params.has('groupBy')).toBe(false);
    });

    it('product sales passes category filters, including empty-string ids', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getProductSalesReport({ ...range, categoryId: '1', subCategoryId: '' } as never).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/product-sales`);
      expect(req.request.params.get('categoryId')).toBe('1');
      expect(req.request.params.get('subCategoryId')).toBe('');
      req.flush([]);
    });

    it('product sales omits undefined category filters', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getProductSalesReport(range as never).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/product-sales`);
      expect(req.request.params.has('categoryId')).toBe(false);
      expect(req.request.params.has('subCategoryId')).toBe(false);
      req.flush([]);
    });

    it.each([
      ['daily-sales', (s: ReportsService) => s.getDailySalesReport({ ...range, source: 1 } as never)],
      ['product-sales', (s: ReportsService) => s.getProductSalesReport({ ...range, source: 1 } as never)],
      ['payments', (s: ReportsService) => s.getPaymentsReport({ ...range, source: 1 } as never)],
      ['hourly', (s: ReportsService) => s.getHourlySalesReport({ ...range, source: 1 } as never)],
      ['staff', (s: ReportsService) => s.getStaffPerformanceReport({ ...range, source: 1 } as never)],
    ])('%s report sends the source when one is chosen', (path, call) => {
      const { service, http } = setupHttpService(ReportsService);
      (call(service) as { subscribe: () => unknown }).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/${path}`);
      expect(req.request.params.get('source')).toBe('1');
      req.flush([]);
    });

    it('sends the shop source (0) and leaves it out for all orders', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getPaymentsReport({ ...range, source: 0 } as never).subscribe();
      service.getPaymentsReport(range as never).subscribe();

      const requests = http.match((r) => r.url === `${base}/payments`);
      expect(requests[0].request.params.get('source')).toBe('0');
      expect(requests[1].request.params.has('source')).toBe(false);
    });

    it('exports carry the source too', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.downloadDailySalesExcel({ ...range, source: 1 } as never).subscribe();
      service.downloadDailySalesPdf({ ...range, source: 0 } as never).subscribe();

      const requests = http.match((r) => r.url === `${base}/daily-sales`);
      expect(requests.map((r) => r.request.params.get('source'))).toEqual(['1', '0']);
    });

    it('staff performance adds staffId only when set', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getStaffPerformanceReport({ ...range, staffId: 's1' } as never).subscribe();
      service.getStaffPerformanceReport({ ...range, staffId: '' } as never).subscribe();

      const [withStaff, without] = http.match((r) => r.url === `${base}/staff`);
      expect(withStaff.request.params.get('staffId')).toBe('s1');
      expect(without.request.params.has('staffId')).toBe(false);
    });

    it('payments and hourly hit their own endpoints with the date range', () => {
      const { service, http } = setupHttpService(ReportsService);
      service.getPaymentsReport(range as never).subscribe();
      service.getHourlySalesReport(range as never).subscribe();

      const payments = http.expectOne((r) => r.url === `${base}/payments`);
      const hourly = http.expectOne((r) => r.url === `${base}/hourly`);
      expect(payments.request.params.get('fromDate')).toBe('2025-01-01');
      expect(hourly.request.params.get('toDate')).toBe('2025-01-31');
    });
  });

  describe('downloads', () => {
    const cases = [
      ['downloadDailySalesExcel', '/daily-sales', xlsx],
      ['downloadProductSalesExcel', '/product-sales', xlsx],
      ['downloadPaymentsExcel', '/payments', xlsx],
      ['downloadHourlySalesExcel', '/hourly', xlsx],
      ['downloadStaffPerformanceExcel', '/staff', xlsx],
      ['downloadDailySalesPdf', '/daily-sales', 'application/pdf'],
      ['downloadProductSalesPdf', '/product-sales', 'application/pdf'],
      ['downloadPaymentsPdf', '/payments', 'application/pdf'],
      ['downloadHourlySalesPdf', '/hourly', 'application/pdf'],
      ['downloadStaffPerformancePdf', '/staff', 'application/pdf'],
    ] as const;

    it.each(cases)('%s requests %s as a blob with Accept %s', (method, path, accept) => {
      const { service, http } = setupHttpService(ReportsService);
      (service[method] as (q: never) => { subscribe: () => void })(range as never).subscribe();

      const req = http.expectOne((r) => r.url === `${base}${path}`);
      expect(req.request.responseType).toBe('blob');
      expect(req.request.headers.get('Accept')).toBe(accept);
      expect(req.request.params.get('fromDate')).toBe('2025-01-01');
      req.flush(new Blob(['x']));
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
      const result = capture(service.getPaymentsReport(range as never));

      failNetwork(http.expectOne((r) => r.url === `${base}/payments`));

      expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(connectivity.checkNow).toHaveBeenCalled();
    });

    it('501 means PDF is not available, even with a server message', () => {
      const { service, http } = setupHttpService(ReportsService);
      const result = capture(service.downloadDailySalesPdf(range as never));

      failWith(http.expectOne((r) => r.url === `${base}/daily-sales`), 501, new Blob([]));

      expect(result.error).toBe(msgs.PdfNotAvailable);
    });

    it('server message beats the per-report fallback', () => {
      const { service, http } = setupHttpService(ReportsService);
      const result = capture(service.getHourlySalesReport(range as never));

      failWith(http.expectOne((r) => r.url === `${base}/hourly`), 400, { message: 'Bad range' });

      expect(result.error).toBe('Bad range');
    });

    it('falls back to a per-report message', () => {
      const { service, http } = setupHttpService(ReportsService);
      const daily = capture(service.getDailySalesReport(range as never));
      failWith(http.expectOne((r) => r.url === `${base}/daily-sales`), 500);
      const product = capture(service.getProductSalesReport(range as never));
      failWith(http.expectOne((r) => r.url === `${base}/product-sales`), 500);
      const staff = capture(service.getStaffPerformanceReport(range as never));
      failWith(http.expectOne((r) => r.url === `${base}/staff`), 500);
      const excel = capture(service.downloadPaymentsExcel(range as never));
      failWith(http.expectOne((r) => r.url === `${base}/payments`), 500, new Blob([]));
      const status = capture(service.getMonthlyWorkbookStatus(2025, 1));
      failWith(http.expectOne((r) => r.url === `${base}/monthly-workbook/status`), 500);
      const generate = capture(service.generateMonthlyWorkbook(2025, 1));
      failWith(http.expectOne((r) => r.url === `${base}/monthly-workbook/generate`), 500);
      const download = capture(service.downloadMonthlyWorkbook(2025, 1));
      failWith(http.expectOne((r) => r.url === `${base}/monthly-workbook/download`), 500, new Blob([]));

      expect(daily.error).toBe(msgs.FetchDailySalesFailed);
      expect(product.error).toBe(msgs.FetchProductSalesFailed);
      expect(staff.error).toBe(msgs.FetchStaffPerformanceFailed);
      expect(excel.error).toBe(msgs.DownloadExcelFailed);
      expect(status.error).toBe(msgs.FetchMonthlyWorkbookStatusFailed);
      expect(generate.error).toBe(msgs.GenerateMonthlyWorkbookFailed);
      expect(download.error).toBe(msgs.DownloadMonthlyWorkbookFailed);
    });
  });
});
