import { environment } from '@environments/environment.development';
import { describe, expect, it } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { UnsyncedOrderService } from './unsynced-order.service';

describe('UnsyncedOrderService', () => {
  const base = `${environment.apiUrl}/orders/unsynced`;

  it('lists with filters and leaves empty ones out', () => {
    const { service, http } = setupHttpService(UnsyncedOrderService);
    capture(service.getUnsyncedOrders({ status: 1, page: 2, pageSize: 20, searchTerm: '', sortBy: 'total', descending: false }));

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('status')).toBe('1');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('descending')).toBe('false');
    expect(req.request.params.has('searchTerm')).toBe(false);
    req.flush({ items: [], page: 2, pageSize: 20, totalCount: 0 });
  });

  it('reads one order', () => {
    const { service, http } = setupHttpService(UnsyncedOrderService);
    capture(service.getUnsyncedOrder('u1'));
    expect(http.expectOne(`${base}/u1`).request.method).toBe('GET');
  });

  it('posts each action to its own endpoint', () => {
    const { service, http } = setupHttpService(UnsyncedOrderService);
    capture(service.retry('u1'));
    expect(http.expectOne(`${base}/u1/retry`).request.method).toBe('POST');

    capture(service.saveAsNote('u1'));
    expect(http.expectOne(`${base}/u1/note-only`).request.method).toBe('POST');

    capture(service.discard('u1', 'Duplicate'));
    const discard = http.expectOne(`${base}/u1/discard`);
    expect(discard.request.method).toBe('POST');
    expect(discard.request.body).toEqual({ reason: 'Duplicate' });
  });

  it('shows the server message, a fallback and the network message', () => {
    const { service, http, connectivity } = setupHttpService(UnsyncedOrderService);

    const refused = capture(service.discard('u1', 'x'));
    failWith(http.expectOne(`${base}/u1/discard`), 400, { message: 'Only open unsynced orders can be discarded.' });
    expect(refused.error).toContain('Only open unsynced orders');

    const fallback = capture(service.retry('u1'));
    failWith(http.expectOne(`${base}/u1/retry`), 500);
    expect(fallback.error).toBe('Unable to retry the order.');

    const offline = capture(service.getUnsyncedOrders());
    failNetwork(http.expectOne((r) => r.url === base));
    expect(offline.error).toBeTruthy();
    expect(connectivity.checkNow).toHaveBeenCalled();
  });
});
