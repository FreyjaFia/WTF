import { environment } from '@environments/environment.development';
import { DateRangeSelection } from '@shared/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capture,
  failNetwork,
  failWith,
  setupHttpService,
} from '../../testing/service-testing';
import { AuditLogService } from './audit-log.service';
import { DashboardService } from './dashboard.service';
import { SchemaScriptHistoryService } from './schema-script-history.service';

afterEach(() => vi.restoreAllMocks());

describe('DashboardService', () => {
  const url = `${environment.apiUrl}/dashboard`;

  it('requests the dashboard without params by default', () => {
    const { service, http } = setupHttpService(DashboardService);
    const result = capture(service.getDashboard());

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ total: 1 });
    expect(result.value).toEqual({ total: 1 });
    http.verify();
  });

  it('sends only the preset for non-custom ranges', () => {
    const { service, http } = setupHttpService(DashboardService);
    service
      .getDashboard({ preset: 'today', startDate: '2025-01-01', endDate: '2025-01-02' } as DateRangeSelection)
      .subscribe();

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('preset')).toBe('today');
    expect(req.request.params.has('startDate')).toBe(false);
    req.flush({});
  });

  it('sends start and end dates for custom ranges', () => {
    const { service, http } = setupHttpService(DashboardService);
    service
      .getDashboard({ preset: 'custom', startDate: '2025-01-01', endDate: '2025-01-31' } as DateRangeSelection)
      .subscribe();

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('startDate')).toBe('2025-01-01');
    expect(req.request.params.get('endDate')).toBe('2025-01-31');
    req.flush({});
  });

  it('omits dates for a custom range that is missing them', () => {
    const { service, http } = setupHttpService(DashboardService);
    service.getDashboard({ preset: 'custom' } as DateRangeSelection).subscribe();

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.has('startDate')).toBe(false);
    req.flush({});
  });

  it('maps a network failure and re-checks connectivity', () => {
    const { service, http, connectivity } = setupHttpService(DashboardService);
    const result = capture(service.getDashboard());

    failNetwork(http.expectOne((r) => r.url === url));

    expect(result.error).toContain('Unable to connect');
    expect(connectivity.checkNow).toHaveBeenCalled();
  });

  it('surfaces the server message, else a fallback', () => {
    const { service, http } = setupHttpService(DashboardService);
    const withMessage = capture(service.getDashboard());
    failWith(http.expectOne((r) => r.url === url), 500, { message: 'db down' });
    const withoutMessage = capture(service.getDashboard());
    failWith(http.expectOne((r) => r.url === url), 500);

    expect(withMessage.error).toBe('db down');
    expect(withoutMessage.error).toBe('Failed to load dashboard. Please try again later.');
  });
});

describe('SchemaScriptHistoryService', () => {
  const url = `${environment.apiUrl}/schema-script-history`;

  it('fetches executed scripts', () => {
    const { service, http } = setupHttpService(SchemaScriptHistoryService);
    const result = capture(service.getExecutedScripts());

    http.expectOne(url).flush([{ scriptName: 'a.sql' }]);

    expect(result.value).toEqual([{ scriptName: 'a.sql' }]);
  });

  it('maps network, server and fallback errors', () => {
    const { service, http, connectivity } = setupHttpService(SchemaScriptHistoryService);
    const network = capture(service.getExecutedScripts());
    failNetwork(http.expectOne(url));
    const server = capture(service.getExecutedScripts());
    failWith(http.expectOne(url), 500, 'boom');
    const fallback = capture(service.getExecutedScripts());
    failWith(http.expectOne(url), 500);

    expect(network.error).toContain('Unable to connect');
    expect(connectivity.checkNow).toHaveBeenCalledTimes(1);
    expect(server.error).toBe('boom');
    expect(fallback.error).toBe('Failed to fetch executed schema scripts. Please try again later.');
  });
});

describe('AuditLogService', () => {
  const url = `${environment.apiUrl}/audit-logs`;

  it('builds query params, skipping empty values and repeating arrays', () => {
    const { service, http } = setupHttpService(AuditLogService);
    service
      .getAuditLogs({
        page: 2,
        search: '',
        action: undefined,
        actions: ['Create', 'Delete'],
      } as never)
      .subscribe();

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.has('search')).toBe(false);
    expect(req.request.params.has('action')).toBe(false);
    expect(req.request.params.getAll('actions')).toEqual(['Create', 'Delete']);
    req.flush({ items: [] });
  });

  it('keeps zero and false query values', () => {
    const { service, http } = setupHttpService(AuditLogService);
    service.getAuditLogs({ page: 0, includeDeleted: false } as never).subscribe();

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('includeDeleted')).toBe('false');
    req.flush({});
  });

  it('fetches actions', () => {
    const { service, http } = setupHttpService(AuditLogService);
    const result = capture(service.getAuditActions());

    http.expectOne(`${url}/actions`).flush(['Create']);

    expect(result.value).toEqual(['Create']);
  });

  it.each([
    ['downloadAuditLogsExcel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['downloadAuditLogsPdf', 'application/pdf'],
  ] as const)('%s requests a blob with the right Accept header', (method, accept) => {
    const { service, http } = setupHttpService(AuditLogService);
    service[method]().subscribe();

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.responseType).toBe('blob');
    expect(req.request.headers.get('Accept')).toBe(accept);
    req.flush(new Blob(['x']));
  });

  it('maps errors: network, server message, then per-call fallback', () => {
    const { service, http, connectivity } = setupHttpService(AuditLogService);
    const network = capture(service.getAuditLogs());
    failNetwork(http.expectOne((r) => r.url === url));
    const server = capture(service.getAuditLogs());
    failWith(http.expectOne((r) => r.url === url), 400, { message: 'bad filter' });
    const logsFallback = capture(service.getAuditLogs());
    failWith(http.expectOne((r) => r.url === url), 500);
    const actionsFallback = capture(service.getAuditActions());
    failWith(http.expectOne(`${url}/actions`), 500);
    const pdfFallback = capture(service.downloadAuditLogsPdf());
    failWith(http.expectOne((r) => r.url === url), 500, new Blob([]));

    expect(network.error).toContain('Unable to connect');
    expect(connectivity.checkNow).toHaveBeenCalledTimes(1);
    expect(server.error).toBe('bad filter');
    expect(logsFallback.error).toBe('Failed to fetch audit logs. Please try again later.');
    expect(actionsFallback.error).toBe('Failed to fetch audit log actions. Please try again later.');
    expect(pdfFallback.error).toBe('Failed to download the PDF file. Please try again later.');
  });
});
