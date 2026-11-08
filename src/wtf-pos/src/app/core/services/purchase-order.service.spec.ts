import { environment } from '@environments/environment.development';
import { describe, expect, it } from 'vitest';
import { capture, failWith, setupHttpService } from '../../testing/service-testing';
import { PurchaseOrderService } from './purchase-order.service';

describe('PurchaseOrderService', () => {
  const url = `${environment.apiUrl}/purchase-orders`;
  const fields = { supplierId: 's1', expectedOn: null, note: null, lines: [] };

  it('lists orders with the filters', () => {
    const { service, http } = setupHttpService(PurchaseOrderService);
    capture(service.getOrders({ supplierId: 's1', openOnly: true }));
    const request = http.expectOne((r) => r.url === url);
    expect(request.request.params.get('supplierId')).toBe('s1');
    expect(request.request.params.get('openOnly')).toBe('true');
    request.flush([]);
  });

  it('gets, creates, drafts from the reorder list and updates', () => {
    const { service, http } = setupHttpService(PurchaseOrderService);
    capture(service.getOrder('p1'));
    http.expectOne(`${url}/p1`).flush({});

    capture(service.createOrder(fields));
    const create = http.expectOne(url);
    expect(create.request.method).toBe('POST');
    create.flush({});

    capture(service.createFromReorder('s1'));
    const draft = http.expectOne(`${url}/from-reorder`);
    expect(draft.request.body).toEqual({ supplierId: 's1' });
    draft.flush({});

    capture(service.updateOrder('p1', fields));
    const update = http.expectOne(`${url}/p1`);
    expect(update.request.method).toBe('PUT');
    update.flush({});
  });

  it('sends, cancels and closes an order', () => {
    const { service, http } = setupHttpService(PurchaseOrderService);
    capture(service.sendOrder('p1'));
    http.expectOne(`${url}/p1/send`).flush({});
    capture(service.cancelOrder('p1'));
    http.expectOne(`${url}/p1/cancel`).flush({});
    capture(service.closeOrder('p1'));
    http.expectOne(`${url}/p1/close`).flush({});
  });

  it('reports the server message', () => {
    const { service, http } = setupHttpService(PurchaseOrderService);
    const result = capture(service.sendOrder('p1'));
    failWith(http.expectOne(`${url}/p1/send`), 400, 'Only a draft can be sent.');

    expect(result.error).toContain('Only a draft');
  });
});
