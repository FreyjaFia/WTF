import { environment } from '@environments/environment.development';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { NotificationService } from './notification.service';
import { SignalRService } from './signalr.service';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NotificationService', () => {
  const base = `${environment.apiUrl}/notifications`;
  const counts = (unreadCount: number, unreadByKind: Record<string, number> = {}) => ({ unreadCount, unreadByKind });

  let changed: Subject<void>;
  let signalR: { startNotificationsHub: ReturnType<typeof vi.fn>; stopNotificationsHub: ReturnType<typeof vi.fn>; notificationsChanged: Subject<void> };

  beforeEach(() => {
    changed = new Subject<void>();
    signalR = { startNotificationsHub: vi.fn(), stopNotificationsHub: vi.fn(), notificationsChanged: changed };
  });

  function setup() {
    return setupHttpService(NotificationService, [{ provide: SignalRService, useValue: signalR }]);
  }

  it('asks for a page and keeps the counts it is told', () => {
    const { service, http } = setup();
    const result = capture(service.list({ kind: 'StockAlert', page: 2, pageSize: 25, unreadOnly: true }));

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('kind')).toBe('StockAlert');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    expect(req.request.params.get('unreadOnly')).toBe('true');
    req.flush({ items: [], totalCount: 0, ...counts(4, { StockAlert: 3, Other: 1 }) });

    expect(result.error).toBeUndefined();
    expect(service.unread()).toBe(4);
    expect(service.unreadByKind()).toEqual({ StockAlert: 3, Other: 1 });
  });

  it('sends no filters when none are given', () => {
    const { service, http } = setup();
    service.list().subscribe();

    expect(http.expectOne((r) => r.url === base).request.params.keys()).toEqual([]);
  });

  it('marks the given notifications read and keeps what is left unread', () => {
    const { service, http } = setup();
    const result = capture(service.markRead({ ids: ['n1'] }));

    const req = http.expectOne(`${base}/read`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ids: ['n1'], kind: null });
    req.flush(counts(2, { StockAlert: 2 }));

    expect(result.value).toEqual(counts(2, { StockAlert: 2 }));
    expect(service.unread()).toBe(2);
  });

  it('marks a whole kind read, or everything when nothing is given', () => {
    const { service, http } = setup();
    service.markRead({ kind: 'StockAlert' }).subscribe();
    expect(http.expectOne(`${base}/read`).request.body).toEqual({ ids: null, kind: 'StockAlert' });

    service.markRead().subscribe();
    const req = http.expectOne(`${base}/read`);
    expect(req.request.body).toEqual({ ids: null, kind: null });
    req.flush(counts(0));
    expect(service.unread()).toBe(0);
  });

  it('turns failures into messages, and a network failure asks the connectivity check', () => {
    const { service, http, connectivity } = setup();
    const server = capture(service.list());
    failWith(http.expectOne((r) => r.url === base), 500, { message: 'Boom' });
    expect(server.error).toBe('Boom');

    const offline = capture(service.markRead());
    failNetwork(http.expectOne(`${base}/read`));
    expect(offline.error).toBe('Network unavailable. Please check your connection.');
    expect(connectivity.checkNow).toHaveBeenCalled();
  });

  it('refreshes only the counts, and a failure keeps the old ones', () => {
    const { service, http } = setup();
    service.refreshCounts();
    http.expectOne(`${base}/counts`).flush(counts(3));
    expect(service.unread()).toBe(3);

    service.refreshCounts();
    failWith(http.expectOne(`${base}/counts`), 500);
    expect(service.unread()).toBe(3);
  });

  it('starts listening once however many screens ask, and stops with the last one', () => {
    const { service, http } = setup();
    service.start();
    service.start();
    http.expectOne(`${base}/counts`).flush(counts(1));

    expect(signalR.startNotificationsHub).toHaveBeenCalledTimes(1);

    service.stop();
    expect(signalR.stopNotificationsHub).not.toHaveBeenCalled();
    service.stop();
    expect(signalR.stopNotificationsHub).toHaveBeenCalledTimes(1);
  });

  it('reloads the counts once for a burst of live changes, and tells open lists', () => {
    vi.useFakeTimers();
    const { service, http } = setup();
    const told = vi.fn();
    service.changed.subscribe(told);
    service.start();
    http.expectOne(`${base}/counts`).flush(counts(0));

    changed.next();
    changed.next();
    changed.next();
    vi.advanceTimersByTime(400);

    http.expectOne(`${base}/counts`).flush(counts(5));
    expect(service.unread()).toBe(5);
    expect(told).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('also reloads the counts now and then, in case the live connection is down', () => {
    vi.useFakeTimers();
    const { service, http } = setup();
    service.start();
    http.expectOne(`${base}/counts`).flush(counts(0));

    vi.advanceTimersByTime(60_000);

    http.expectOne(`${base}/counts`).flush(counts(2));
    expect(service.unread()).toBe(2);
    service.stop();
  });

  it('ignores live changes after the last screen stopped', () => {
    vi.useFakeTimers();
    const { service, http } = setup();
    service.start();
    http.expectOne(`${base}/counts`).flush(counts(0));
    service.stop();

    changed.next();
    vi.advanceTimersByTime(400);

    http.expectNone(`${base}/counts`);
  });
});
