import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { StockAlertService } from './stock-alert.service';

afterEach(() => vi.restoreAllMocks());

describe('StockAlertService', () => {
  const base = `${environment.apiUrl}/stock-notifications`;
  const list = (unreadCount: number) => ({ items: [], totalCount: 0, unreadCount });

  it('asks for a page and keeps the unread count it is told', () => {
    const { service, http } = setupHttpService(StockAlertService);
    const result = capture(service.list({ page: 2, pageSize: 25, unreadOnly: true }));

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    expect(req.request.params.get('unreadOnly')).toBe('true');
    req.flush(list(4));

    expect((result.value as { unreadCount: number }).unreadCount).toBe(4);
    expect(service.unread()).toBe(4);
  });

  it('sends no filters when none are given', () => {
    const { service, http } = setupHttpService(StockAlertService);
    service.list().subscribe();

    expect(http.expectOne((r) => r.url === base).request.params.keys()).toEqual([]);
  });

  it('marks the given alerts read and keeps what is left unread', () => {
    const { service, http } = setupHttpService(StockAlertService);
    const result = capture(service.markRead(['n1']));

    const req = http.expectOne(`${base}/read`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ids: ['n1'] });
    req.flush({ unreadCount: 2 });

    expect(result.value).toBe(2);
    expect(service.unread()).toBe(2);
  });

  it('marks everything read when no ids are given', () => {
    const { service, http } = setupHttpService(StockAlertService);
    service.markRead().subscribe();

    const req = http.expectOne(`${base}/read`);
    expect(req.request.body).toEqual({ ids: null });
    req.flush({ unreadCount: 0 });

    expect(service.unread()).toBe(0);
  });

  it('refresh reloads only the count', () => {
    const { service, http } = setupHttpService(StockAlertService);
    service.refresh();

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('unreadOnly')).toBe('true');
    expect(req.request.params.get('pageSize')).toBe('1');
    req.flush(list(7));

    expect(service.unread()).toBe(7);
  });

  it('refresh keeps the old count and raises nothing when it fails', () => {
    const { service, http } = setupHttpService(StockAlertService);
    service.refresh();
    http.expectOne((r) => r.url === base).flush(list(3));

    service.refresh();
    failWith(http.expectOne((r) => r.url === base), 500);

    expect(service.unread()).toBe(3);
  });

  it('prefers the server message and falls back to a plain one', () => {
    const { service, http } = setupHttpService(StockAlertService);
    const withMessage = capture(service.markRead());
    failWith(http.expectOne(`${base}/read`), 400, { message: 'Nope.' });
    const plain = capture(service.list());
    failWith(http.expectOne((r) => r.url === base), 500);

    expect(withMessage.error).toBe('Nope.');
    expect(plain.error).toBe('Unable to fetch the stock alerts.');
  });

  it('maps a network failure and re-checks connectivity', () => {
    const { service, http, connectivity } = setupHttpService(StockAlertService);
    const result = capture(service.list());

    failNetwork(http.expectOne((r) => r.url === base));

    expect(result.error).toBe('Network unavailable. Please check your connection.');
    expect(connectivity.checkNow).toHaveBeenCalled();
  });
});
