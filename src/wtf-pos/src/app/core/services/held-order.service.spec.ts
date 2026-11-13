import { environment } from '@environments/environment.development';
import { describe, expect, it } from 'vitest';
import { capture, failWith, setupHttpService } from '../../testing/service-testing';
import { HeldOrderService } from './held-order.service';

describe('HeldOrderService', () => {
  const url = `${environment.apiUrl}/orders/review`;

  it('asks for the held orders with only the filters that are set', () => {
    const { service, http } = setupHttpService(HeldOrderService);
    const result = capture(
      service.getHeldOrders({
        reasonCodes: ['PriceChanged', 'ProductInactive'],
        cashierId: 'c1',
        fromDate: '2026-11-01',
        toDate: null,
        agedOnly: true,
      }),
    );

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('reasonCodes')).toBe('PriceChanged,ProductInactive');
    expect(req.request.params.get('cashierId')).toBe('c1');
    expect(req.request.params.get('fromDate')).toBe('2026-11-01');
    expect(req.request.params.has('toDate')).toBe(false);
    expect(req.request.params.get('agedOnly')).toBe('true');
    req.flush({ items: [], totalCount: 0 });
    expect(result.value).toEqual({ items: [], totalCount: 0 });
  });

  it('sends no query when nothing is filtered', () => {
    const { service, http } = setupHttpService(HeldOrderService);
    capture(service.getHeldOrders());

    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ items: [] });
  });

  it('posts the filter with the preview flag to bulk approve', () => {
    const { service, http } = setupHttpService(HeldOrderService);
    const result = capture(service.bulkApprove({ reasonCodes: ['PriceChanged'], ids: ['a'] }, true));

    const req = http.expectOne(`${url}/bulk-approve`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reasonCodes: ['PriceChanged'], ids: ['a'], preview: true });
    req.flush({ preview: true, count: 1 });
    expect(result.value).toEqual({ preview: true, count: 1 });
  });

  it('turns a failed approve into a plain message', () => {
    const { service, http } = setupHttpService(HeldOrderService);
    const result = capture(service.bulkApprove({}, false));
    failWith(http.expectOne(`${url}/bulk-approve`), 500);

    expect(result.error).toBe('Unable to approve the orders. Nothing was changed.');
  });

  it('uses the server message when there is one', () => {
    const { service, http } = setupHttpService(HeldOrderService);
    const result = capture(service.getHeldOrders());
    failWith(http.expectOne((r) => r.url === url), 400, { message: 'Nope' });

    expect(result.error).toBe('Nope');
  });
});
