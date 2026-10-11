import { ServiceErrorMessages, HttpErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { OrderStatusEnum } from '@shared/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { OrderService } from './order.service';

afterEach(() => vi.restoreAllMocks());

describe('OrderService', () => {
  const base = `${environment.apiUrl}/orders`;
  const msgs = ServiceErrorMessages.Order;

  describe('getOrders', () => {
    it('sends status and customer filters', () => {
      const { service, http } = setupHttpService(OrderService);
      service.getOrders({ status: OrderStatusEnum.Completed, customerId: 'c1' }).subscribe();

      const req = http.expectOne((r) => r.url === base);
      expect(req.request.params.get('status')).toBe(String(OrderStatusEnum.Completed));
      expect(req.request.params.get('customerId')).toBe('c1');
      req.flush([]);
    });

    it('treats the All status as no filter', () => {
      const { service, http } = setupHttpService(OrderService);
      service.getOrders({ status: OrderStatusEnum.All, customerId: null }).subscribe();

      const req = http.expectOne((r) => r.url === base);
      expect(req.request.params.keys()).toEqual([]);
      req.flush([]);
    });
  });

  describe('getOrdersPaged', () => {
    it('sends trimmed search and paging, keeping page 0', () => {
      const { service, http } = setupHttpService(OrderService);
      service
        .getOrdersPaged({ searchTerm: '  1001 ', page: 0, pageSize: 25, status: OrderStatusEnum.Pending })
        .subscribe();

      const req = http.expectOne((r) => r.url === `${base}/paged`);
      expect(req.request.params.get('searchTerm')).toBe('1001');
      expect(req.request.params.get('page')).toBe('0');
      expect(req.request.params.get('pageSize')).toBe('25');
      expect(req.request.params.get('status')).toBe(String(OrderStatusEnum.Pending));
      req.flush({ items: [] });
    });

    it('drops blank search terms', () => {
      const { service, http } = setupHttpService(OrderService);
      service.getOrdersPaged({ searchTerm: '   ' }).subscribe();

      const req = http.expectOne((r) => r.url === `${base}/paged`);
      expect(req.request.params.has('searchTerm')).toBe(false);
      req.flush({});
    });
  });

  it('active and history endpoints pass the customer filter', () => {
    const { service, http } = setupHttpService(OrderService);
    service.getActiveOrders({ customerId: 'c1' }).subscribe();
    service.getOrderHistory({ customerId: 'c2' }).subscribe();

    const active = http.expectOne((r) => r.url === `${base}/active`);
    const history = http.expectOne((r) => r.url === `${base}/history`);
    expect(active.request.params.get('customerId')).toBe('c1');
    expect(history.request.params.get('customerId')).toBe('c2');
    active.flush([]);
    history.flush([]);
  });

  it('calls the right endpoint and verb for each operation', () => {
    const { service, http } = setupHttpService(OrderService);

    service.getOrder('1').subscribe();
    expect(http.expectOne(`${base}/1`).request.method).toBe('GET');

    service.createOrder({ items: [] } as never).subscribe();
    expect(http.expectOne(base).request.method).toBe('POST');

    service.createOrdersBatch([{ items: [] }] as never).subscribe();
    const batch = http.expectOne(`${base}/batch`);
    expect(batch.request.method).toBe('POST');
    expect(batch.request.body).toEqual({ orders: [{ items: [] }] });

    service.updateOrder({ id: '2' } as never).subscribe();
    expect(http.expectOne(`${base}/2`).request.method).toBe('PUT');

    service.overrideOrder({ id: '3' } as never).subscribe();
    expect(http.expectOne(`${base}/3/override`).request.method).toBe('PUT');

    service.voidOrder('4', 'wrong order').subscribe();
    const voided = http.expectOne(`${base}/4/void`);
    expect(voided.request.method).toBe('PATCH');
    expect(voided.request.body).toEqual({ note: 'wrong order' });

    service.voidOrder('5').subscribe();
    expect(http.expectOne(`${base}/5/void`).request.body).toEqual({ note: null });
  });

  describe('orders waiting for approval', () => {
    it('lists them with the PendingApproval status and returns just the orders', () => {
      const { service, http } = setupHttpService(OrderService);
      const result = capture(service.getAwaitingOrders());

      const req = http.expectOne((r) => r.url === `${base}/paged`);
      expect(req.request.params.get('status')).toBe(String(OrderStatusEnum.PendingApproval));
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('pageSize')).toBe('50');
      req.flush({ items: [{ id: 'o1' }, { id: 'o2' }], page: 1, pageSize: 50, totalCount: 2 });

      expect(result.value).toEqual([{ id: 'o1' }, { id: 'o2' }]);
    });

    it('accepts an order with a POST to approve', () => {
      const { service, http } = setupHttpService(OrderService);
      const result = capture(service.approveOrder('7'));

      const req = http.expectOne(`${base}/7/approve`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: '7', status: OrderStatusEnum.Pending });

      expect(result.value).toMatchObject({ id: '7', status: OrderStatusEnum.Pending });
    });

    it('marks an order ready with a POST to ready', () => {
      const { service, http } = setupHttpService(OrderService);
      const result = capture(service.markOrderReady('9'));

      const req = http.expectOne(`${base}/9/ready`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: '9', readyAt: '2026-10-12T10:00:00Z' });

      expect(result.value).toMatchObject({ id: '9', readyAt: '2026-10-12T10:00:00Z' });
    });

    it('says why marking ready failed', () => {
      const { service, http } = setupHttpService(OrderService);
      const server = capture(service.markOrderReady('1'));
      failWith(http.expectOne(`${base}/1/ready`), 400, { message: 'This order is already marked ready.' });
      const bad = capture(service.markOrderReady('1'));
      failWith(http.expectOne(`${base}/1/ready`), 400);
      const missing = capture(service.markOrderReady('1'));
      failWith(http.expectOne(`${base}/1/ready`), 404);
      const other = capture(service.markOrderReady('1'));
      failWith(http.expectOne(`${base}/1/ready`), 500);

      expect(server.error).toBe('This order is already marked ready.');
      expect(bad.error).toBe(msgs.OrderCannotBeMarkedReady);
      expect(missing.error).toBe(msgs.OrderNotFound);
      expect(other.error).toBe(msgs.MarkReadyFailed);
    });

    it('rejects an order with a POST to reject carrying the reason', () => {
      const { service, http } = setupHttpService(OrderService);
      service.rejectOrder('8', 'Out of stock').subscribe();

      const req = http.expectOne(`${base}/8/reject`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ reason: 'Out of stock' });
    });

    it('prefers the server message', () => {
      const { service, http } = setupHttpService(OrderService);
      const approve = capture(service.approveOrder('1'));
      failWith(http.expectOne(`${base}/1/approve`), 400, {
        message: 'Only orders waiting for approval can be accepted.',
      });
      const reject = capture(service.rejectOrder('1', 'x'));
      failWith(http.expectOne(`${base}/1/reject`), 400, { message: 'A reason is required to reject an order.' });

      expect(approve.error).toBe('Only orders waiting for approval can be accepted.');
      expect(reject.error).toBe('A reason is required to reject an order.');
    });

    it('maps 400 and 404 without a server message', () => {
      const { service, http } = setupHttpService(OrderService);
      const approve400 = capture(service.approveOrder('1'));
      failWith(http.expectOne(`${base}/1/approve`), 400);
      const reject400 = capture(service.rejectOrder('1', 'x'));
      failWith(http.expectOne(`${base}/1/reject`), 400);
      const approve404 = capture(service.approveOrder('1'));
      failWith(http.expectOne(`${base}/1/approve`), 404);
      const reject404 = capture(service.rejectOrder('1', 'x'));
      failWith(http.expectOne(`${base}/1/reject`), 404);

      expect(approve400.error).toBe(msgs.OrderNotWaiting);
      expect(reject400.error).toBe(msgs.OrderNotWaiting);
      expect(approve404.error).toBe(msgs.OrderNotFound);
      expect(reject404.error).toBe(msgs.OrderNotFound);
    });

    it('falls back to a plain message for other failures and handles a lost connection', () => {
      const { service, http, connectivity } = setupHttpService(OrderService);
      const approve = capture(service.approveOrder('1'));
      failWith(http.expectOne(`${base}/1/approve`), 500);
      const reject = capture(service.rejectOrder('1', 'x'));
      failWith(http.expectOne(`${base}/1/reject`), 500);
      const offline = capture(service.approveOrder('1'));
      failNetwork(http.expectOne(`${base}/1/approve`));

      expect(approve.error).toBe(msgs.ApproveOrderFailed);
      expect(reject.error).toBe(msgs.RejectOrderFailed);
      expect(offline.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(connectivity.checkNow).toHaveBeenCalled();
    });
  });

  describe('error mapping', () => {
    it('network loss re-checks connectivity', () => {
      const { service, http, connectivity } = setupHttpService(OrderService);
      const result = capture(service.getOrder('1'));

      failNetwork(http.expectOne(`${base}/1`));

      expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(connectivity.checkNow).toHaveBeenCalled();
    });

    it('server message wins over status mapping', () => {
      const { service, http } = setupHttpService(OrderService);
      const result = capture(service.voidOrder('1'));

      failWith(http.expectOne(`${base}/1/void`), 400, { message: 'Already voided' });

      expect(result.error).toBe('Already voided');
    });

    it('400 maps per operation when the server sends no message', () => {
      const { service, http } = setupHttpService(OrderService);
      const create = capture(service.createOrder({} as never));
      failWith(http.expectOne(base), 400);
      const batch = capture(service.createOrdersBatch([]));
      failWith(http.expectOne(`${base}/batch`), 400);
      const update = capture(service.updateOrder({ id: '1' } as never));
      failWith(http.expectOne(`${base}/1`), 400);
      const voided = capture(service.voidOrder('1'));
      failWith(http.expectOne(`${base}/1/void`), 400);
      const list = capture(service.getOrders());
      failWith(http.expectOne((r) => r.url === base), 400);

      expect(create.error).toBe(msgs.InvalidOrderData);
      expect(batch.error).toBe(msgs.InvalidOrderBatchData);
      expect(update.error).toBe(msgs.InvalidOrderData);
      expect(voided.error).toBe(msgs.OrderCannotBeVoided);
      // getOrders has no 400 mapping, so it uses the fallback.
      expect(list.error).toBe(msgs.FetchOrdersFailed);
    });

    it('404 maps to not found where configured, else the fallback', () => {
      const { service, http } = setupHttpService(OrderService);
      const get = capture(service.getOrder('1'));
      failWith(http.expectOne(`${base}/1`), 404);
      const override = capture(service.overrideOrder({ id: '1' } as never));
      failWith(http.expectOne(`${base}/1/override`), 404);
      const create = capture(service.createOrder({} as never));
      failWith(http.expectOne(base), 404);

      expect(get.error).toBe(msgs.OrderNotFound);
      expect(override.error).toBe(msgs.OrderNotFound);
      expect(create.error).toBe(msgs.CreateOrderFailed);
    });

    it('unmapped statuses use each operation fallback', () => {
      const { service, http } = setupHttpService(OrderService);
      const paged = capture(service.getOrdersPaged());
      failWith(http.expectOne((r) => r.url === `${base}/paged`), 500);
      const sync = capture(service.createOrdersBatch([]));
      failWith(http.expectOne(`${base}/batch`), 500);
      const override = capture(service.overrideOrder({ id: '1' } as never));
      failWith(http.expectOne(`${base}/1/override`), 500);

      expect(paged.error).toBe(msgs.FetchOrdersFailed);
      expect(sync.error).toBe(msgs.SyncOrdersFailed);
      expect(override.error).toBe(msgs.OverrideOrderFailed);
    });
  });
});
