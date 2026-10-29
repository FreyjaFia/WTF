import { environment } from '@environments/environment.development';
import { StockWasteDto, StockWasteSource } from '@shared/models';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { NotificationService } from './notification.service';
import { SignalRService } from './signalr.service';
import { StockWasteService } from './stock-waste.service';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('StockWasteService', () => {
  const url = `${environment.apiUrl}/stock-waste`;
  const countUrl = `${url}/pending-count`;
  const entry = { id: 'w1', status: 'Recorded' } as StockWasteDto;

  let signalR: {
    startNotificationsHub: ReturnType<typeof vi.fn>;
    stopNotificationsHub: ReturnType<typeof vi.fn>;
    stockChanged: Subject<string>;
    notificationsChanged: Subject<void>;
  };
  let notifications: { refreshCounts: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    notifications = { refreshCounts: vi.fn() };
    signalR = {
      startNotificationsHub: vi.fn(),
      stopNotificationsHub: vi.fn(),
      stockChanged: new Subject<string>(),
      notificationsChanged: new Subject<void>(),
    };
  });

  function setup() {
    return setupHttpService(StockWasteService, [
      { provide: SignalRService, useValue: signalR },
      { provide: NotificationService, useValue: notifications },
    ]);
  }

  it('records waste against the item without sending the item id in the body', () => {
    const { service, http } = setup();
    const result = capture(
      service.recordWaste({
        itemId: 'item-1',
        quantity: 250,
        wasteReasonId: 2,
        notes: 'Dropped',
        source: StockWasteSource.Pos,
      }),
    );
    const req = http.expectOne(`${environment.apiUrl}/items/item-1/stock/waste`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ quantity: 250, wasteReasonId: 2, notes: 'Dropped', source: 2 });
    req.flush(entry);

    expect(result.value).toEqual(entry);
  });

  it('sends the client request id so a retry is not saved twice', () => {
    const { service, http } = setup();
    capture(service.recordWaste({ itemId: 'i', quantity: 1, wasteReasonId: 1, clientRequestId: 'req-1' }));
    const req = http.expectOne(`${environment.apiUrl}/items/i/stock/waste`);
    expect(req.request.body).toEqual({ quantity: 1, wasteReasonId: 1, clientRequestId: 'req-1' });
    req.flush(entry);
  });

  it('loads the items the register may waste from the POS endpoint', () => {
    const { service, http } = setup();
    const items = [{ id: 'i', name: 'Milk', baseUnit: 'ml', currentQuantity: 5, allowNegativeStock: true }];
    const result = capture(service.getWasteItems());
    const req = http.expectOne(`${environment.apiUrl}/pos/waste-items`);
    expect(req.request.method).toBe('GET');
    req.flush(items);

    expect(result.value).toEqual(items);
  });

  it('uses its own message when the POS items fail to load', () => {
    const { service, http } = setup();
    const result = capture(service.getWasteItems());
    failWith(http.expectOne(`${environment.apiUrl}/pos/waste-items`), 500);

    expect(result.error).toBe('Unable to fetch the items.');
  });

  it('passes the server refusal when recording', () => {
    const { service, http } = setup();
    const result = capture(service.recordWaste({ itemId: 'i', quantity: 1, wasteReasonId: 1 }));
    failWith(http.expectOne(`${environment.apiUrl}/items/i/stock/waste`), 400, {
      message: 'Cup Lid has 1 pc, the waste needs 3 pc.',
    });

    expect(result.error).toBe('Cup Lid has 1 pc, the waste needs 3 pc.');
  });

  it('sends only the filters that are set', () => {
    const { service, http } = setup();
    capture(
      service.getWaste({
        fromDate: '2026-10-01',
        toDate: '',
        itemId: null,
        wasteReasonId: 4,
        status: 'PendingReview',
        createdBy: undefined,
        page: 2,
        pageSize: 20,
      }),
    );
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().sort()).toEqual(['fromDate', 'page', 'pageSize', 'status', 'wasteReasonId']);
    expect(req.request.params.get('wasteReasonId')).toBe('4');
    expect(req.request.params.get('status')).toBe('PendingReview');
    req.flush({ items: [], totalCount: 0, pendingCount: 0 });
    http.verify();
  });

  it('sends no params without a query', () => {
    const { service, http } = setup();
    capture(service.getWaste());
    const req = http.expectOne(url);
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ items: [], totalCount: 0, pendingCount: 0 });
  });

  it('keeps the pending count it fetched', () => {
    const { service, http } = setup();
    capture(service.getPendingCount());
    http.expectOne(countUrl).flush({ count: 4 });

    expect(service.pendingCount()).toBe(4);
  });

  it('confirms with an optional note, sending null when empty', () => {
    const { service, http } = setup();
    capture(service.confirm('w1', ''));
    const req = http.expectOne(`${url}/w1/confirm`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: null });
    req.flush(entry);

    capture(service.confirm('w1', 'Checked'));
    expect(http.expectOne(`${url}/w1/confirm`).request.body).toEqual({ note: 'Checked' });
  });

  it('disputes and reverses with their notes', () => {
    const { service, http } = setup();
    capture(service.dispute('w1', 'Not seen'));
    const dispute = http.expectOne(`${url}/w1/dispute`);
    expect(dispute.request.method).toBe('POST');
    expect(dispute.request.body).toEqual({ note: 'Not seen' });
    dispute.flush(entry);

    capture(service.reverse('w1', 'Wrong item'));
    const reverse = http.expectOne(`${url}/w1/reverse`);
    expect(reverse.request.method).toBe('POST');
    expect(reverse.request.body).toEqual({ reason: 'Wrong item' });
    reverse.flush(entry);
    http.verify();
  });

  it('does not refresh the count after a review when nothing started it', () => {
    const { service, http } = setup();
    capture(service.confirm('w1'));
    http.expectOne(`${url}/w1/confirm`).flush(entry);

    http.expectNone(countUrl);
    expect(notifications.refreshCounts).toHaveBeenCalledOnce();
  });

  it('refreshes the notification counts after every review action', () => {
    const { service, http } = setup();
    capture(service.confirm('w1'));
    http.expectOne(`${url}/w1/confirm`).flush(entry);
    capture(service.dispute('w1', 'No'));
    http.expectOne(`${url}/w1/dispute`).flush(entry);
    capture(service.reverse('w1', 'Wrong'));
    http.expectOne(`${url}/w1/reverse`).flush(entry);

    expect(notifications.refreshCounts).toHaveBeenCalledTimes(3);
  });

  it('does not refresh the notification counts when a review fails', () => {
    const { service, http } = setup();
    capture(service.confirm('w1'));
    failWith(http.expectOne(`${url}/w1/confirm`), 400);

    expect(notifications.refreshCounts).not.toHaveBeenCalled();
  });

  it('refreshes the count after a review once started', () => {
    const { service, http } = setup();
    service.startPendingCount();
    http.expectOne(countUrl).flush({ count: 2 });

    capture(service.dispute('w1', 'No'));
    http.expectOne(`${url}/w1/dispute`).flush(entry);
    http.expectOne(countUrl).flush({ count: 1 });

    expect(service.pendingCount()).toBe(1);
    service.stopPendingCount();
  });

  it('uses its own messages when the server gives none', () => {
    const { service, http } = setup();
    const confirm = capture(service.confirm('a'));
    failWith(http.expectOne(`${url}/a/confirm`), 500);
    const dispute = capture(service.dispute('a', 'x'));
    failWith(http.expectOne(`${url}/a/dispute`), 500);
    const reverse = capture(service.reverse('a', 'x'));
    failWith(http.expectOne(`${url}/a/reverse`), 500);
    const list = capture(service.getWaste());
    failWith(http.expectOne(url), 500);
    const count = capture(service.getPendingCount());
    failWith(http.expectOne(countUrl), 500);

    expect(confirm.error).toBe('Unable to confirm the waste.');
    expect(dispute.error).toBe('Unable to dispute the waste.');
    expect(reverse.error).toBe('Unable to reverse the waste.');
    expect(list.error).toBe('Unable to fetch the waste entries.');
    expect(count.error).toBe('Unable to fetch the waste waiting for review.');
  });

  it('reports a network failure and asks for a connection check', () => {
    const { service, http, connectivity } = setup();
    const result = capture(service.reverse('a', 'x'));
    failNetwork(http.expectOne(`${url}/a/reverse`));

    expect(result.error).toBe('Network unavailable. Please check your connection.');
    expect(connectivity.checkNow).toHaveBeenCalledOnce();
  });

  describe('pending count lifecycle', () => {
    it('starts the hub once for several users and stops it after the last', () => {
      const { service, http } = setup();
      service.startPendingCount();
      service.startPendingCount();
      http.expectOne(countUrl).flush({ count: 0 });

      expect(signalR.startNotificationsHub).toHaveBeenCalledOnce();

      service.stopPendingCount();
      expect(signalR.stopNotificationsHub).not.toHaveBeenCalled();
      service.stopPendingCount();
      expect(signalR.stopNotificationsHub).toHaveBeenCalledOnce();
      service.stopPendingCount();
      expect(signalR.stopNotificationsHub).toHaveBeenCalledOnce();
    });

    it('refreshes once shortly after a burst of stock or notification changes', () => {
      vi.useFakeTimers();
      const { service, http } = setup();
      service.startPendingCount();
      http.expectOne(countUrl).flush({ count: 0 });

      signalR.stockChanged.next('item-1');
      signalR.notificationsChanged.next();
      signalR.stockChanged.next('item-2');
      http.expectNone(countUrl);

      vi.advanceTimersByTime(400);
      http.expectOne(countUrl).flush({ count: 3 });
      expect(service.pendingCount()).toBe(3);
      service.stopPendingCount();
    });

    it('polls every minute and stops polling when stopped', () => {
      vi.useFakeTimers();
      const { service, http } = setup();
      service.startPendingCount();
      http.expectOne(countUrl).flush({ count: 0 });

      vi.advanceTimersByTime(60_000);
      http.expectOne(countUrl).flush({ count: 1 });

      service.stopPendingCount();
      vi.advanceTimersByTime(120_000);
      signalR.stockChanged.next('x');
      vi.advanceTimersByTime(1000);
      http.expectNone(countUrl);
    });

    it('swallows a failed background refresh', () => {
      const { service, http } = setup();
      service.startPendingCount();
      failWith(http.expectOne(countUrl), 500);

      expect(service.pendingCount()).toBe(0);
      service.stopPendingCount();
    });
  });
});
