import { environment } from '@environments/environment.development';
import { StockAttentionDto } from '@shared/models';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { SignalRService } from './signalr.service';
import { StockAttentionService } from './stock-attention.service';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('StockAttentionService', () => {
  const url = `${environment.apiUrl}/items/attention`;
  const item = (name: string, status: 'Warning' | 'Critical' | 'OutOfStock') => ({
    id: name,
    name,
    unitName: 'ml',
    currentQuantity: 10,
    warningQuantity: 50,
    criticalQuantity: 20,
    status,
    allowNegativeStock: true,
    productCount: 1,
    salesCovered: 1,
  });
  const data = (): StockAttentionDto => ({
    items: [item('Out', 'OutOfStock'), item('Crit', 'Critical'), item('Low', 'Warning')],
    outCount: 1,
    criticalCount: 1,
    warningCount: 1,
    totalCount: 3,
  });

  let stockChanged: Subject<string>;
  let signalR: { startNotificationsHub: ReturnType<typeof vi.fn>; stopNotificationsHub: ReturnType<typeof vi.fn>; stockChanged: Subject<string> };

  beforeEach(() => {
    stockChanged = new Subject<string>();
    signalR = { startNotificationsHub: vi.fn(), stopNotificationsHub: vi.fn(), stockChanged };
  });

  function setup() {
    return setupHttpService(StockAttentionService, [{ provide: SignalRService, useValue: signalR }]);
  }

  it('starts empty and not loaded', () => {
    const { service } = setup();

    expect(service.count()).toBe(0);
    expect(service.items()).toEqual([]);
    expect(service.hasLoaded()).toBe(false);
  });

  it('keeps what the server says: the list, the counts and what is urgent', () => {
    const { service, http } = setup();
    const result = capture(service.load());
    http.expectOne(url).flush(data());

    expect(result.error).toBeUndefined();
    expect(service.items().map((i) => i.name)).toEqual(['Out', 'Crit', 'Low']);
    expect(service.count()).toBe(3);
    expect(service.outCount()).toBe(1);
    expect(service.criticalCount()).toBe(1);
    expect(service.warningCount()).toBe(1);
    expect(service.urgentCount()).toBe(2);
    expect(service.hasLoaded()).toBe(true);
  });

  it('is only not urgent when every item is just running low', () => {
    const { service, http } = setup();
    service.load().subscribe();
    http.expectOne(url).flush({ items: [item('Low', 'Warning')], outCount: 0, criticalCount: 0, warningCount: 1, totalCount: 1 });

    expect(service.count()).toBe(1);
    expect(service.urgentCount()).toBe(0);
  });

  it('turns failures into messages, and a quiet refresh keeps what is shown', () => {
    const { service, http, connectivity } = setup();
    service.load().subscribe();
    http.expectOne(url).flush(data());

    service.refresh();
    failNetwork(http.expectOne(url));

    expect(service.count()).toBe(3);
    expect(connectivity.checkNow).toHaveBeenCalled();

    const result = capture(service.load());
    failWith(http.expectOne(url), 500, { message: 'Boom' });
    expect(result.error).toBe('Boom');
  });

  it('starts watching once however many screens ask, and stops with the last one', () => {
    const { service, http } = setup();
    service.start();
    service.start();
    http.expectOne(url).flush(data());

    expect(signalR.startNotificationsHub).toHaveBeenCalledTimes(1);
    service.stop();
    expect(signalR.stopNotificationsHub).not.toHaveBeenCalled();
    service.stop();
    expect(signalR.stopNotificationsHub).toHaveBeenCalledTimes(1);
  });

  it('reloads once for a burst of stock changes, so the list follows the sales', () => {
    vi.useFakeTimers();
    const { service, http } = setup();
    service.start();
    http.expectOne(url).flush({ items: [], outCount: 0, criticalCount: 0, warningCount: 0, totalCount: 0 });

    stockChanged.next('a');
    stockChanged.next('b');
    stockChanged.next('c');
    vi.advanceTimersByTime(500);

    http.expectOne(url).flush(data());
    expect(service.count()).toBe(3);
    service.stop();
  });

  it('also reloads now and then, in case the live connection is down', () => {
    vi.useFakeTimers();
    const { service, http } = setup();
    service.start();
    http.expectOne(url).flush(data());

    vi.advanceTimersByTime(60_000);

    http.expectOne(url).flush(data());
    service.stop();
  });

  it('ignores stock changes after the last screen stopped', () => {
    vi.useFakeTimers();
    const { service, http } = setup();
    service.start();
    http.expectOne(url).flush(data());
    service.stop();

    stockChanged.next('a');
    vi.advanceTimersByTime(500);

    http.expectNone(url);
  });
});
