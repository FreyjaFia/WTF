import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { PublicLinkInvalidError, PublicOrderService } from './public-order.service';

afterEach(() => vi.restoreAllMocks());

describe('PublicOrderService', () => {
  const base = `${environment.apiUrl}/public/order-links`;

  it('loads the link and its catalog and asks for a fresh copy', () => {
    const { service, http } = setupHttpService(PublicOrderService);
    const result = capture(service.getLink('tok-1'));

    const req = http.expectOne(`${base}/tok-1`);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
    req.flush({ firstName: 'Ana', catalog: { products: [], addOnsByProductId: {} } });

    expect((result.value as { firstName: string }).firstName).toBe('Ana');
  });

  it('encodes the token in the address', () => {
    const { service, http } = setupHttpService(PublicOrderService);
    service.getLink('a/b c').subscribe();

    http.expectOne(`${base}/a%2Fb%20c`).flush({});
  });

  it('lists orders with paging', () => {
    const { service, http } = setupHttpService(PublicOrderService);
    service.getOrders('tok', 2, 10).subscribe();

    const req = http.expectOne((r) => r.url === `${base}/tok/orders`);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
    req.flush({ items: [], page: 2, pageSize: 10, totalCount: 0 });
  });

  it('defaults to the first page of 20 orders', () => {
    const { service, http } = setupHttpService(PublicOrderService);
    service.getOrders('tok').subscribe();

    const req = http.expectOne((r) => r.url === `${base}/tok/orders`);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
  });

  it('loads one order', () => {
    const { service, http } = setupHttpService(PublicOrderService);
    service.getOrder('tok', 'o1').subscribe();

    expect(http.expectOne(`${base}/tok/orders/o1`).request.method).toBe('GET');
  });

  it('turns a 404 into the invalid link error on every call', () => {
    const { service, http } = setupHttpService(PublicOrderService);
    const errors: unknown[] = [];
    const grab = (obs: { subscribe: (o: { error: (e: unknown) => void }) => unknown }) =>
      obs.subscribe({ error: (e) => errors.push(e) });

    grab(service.getLink('tok'));
    failWith(http.expectOne(`${base}/tok`), 404);
    grab(service.getOrders('tok'));
    failWith(http.expectOne((r) => r.url === `${base}/tok/orders`), 404);
    grab(service.getOrder('tok', 'o1'));
    failWith(http.expectOne(`${base}/tok/orders/o1`), 404);

    expect(errors.length).toBe(3);
    for (const error of errors) {
      expect(error).toBeInstanceOf(PublicLinkInvalidError);
      expect((error as Error).message).toBe('This link is no longer valid.');
    }
  });

  it('maps network, rate limit and other failures to readable messages', () => {
    const { service, http } = setupHttpService(PublicOrderService);

    const network = capture(service.getLink('tok'));
    failNetwork(http.expectOne(`${base}/tok`));
    const limited = capture(service.getLink('tok'));
    failWith(http.expectOne(`${base}/tok`), 429);
    const server = capture(service.getLink('tok'));
    failWith(http.expectOne(`${base}/tok`), 500);
    const ordersServer = capture(service.getOrders('tok'));
    failWith(http.expectOne((r) => r.url === `${base}/tok/orders`), 500);

    expect(network.error).toContain('Unable to connect');
    expect(limited.error).toContain('Too many requests');
    expect(server.error).toBe('Failed to load the menu. Please try again.');
    expect(ordersServer.error).toBe('Failed to load your orders. Please try again.');
  });

  it('does not keep any copy of what it loaded', () => {
    const { service, http } = setupHttpService(PublicOrderService);
    service.getLink('tok').subscribe();
    http.expectOne(`${base}/tok`).flush({ firstName: 'Ana' });

    // A second call goes back to the server instead of answering from memory.
    service.getLink('tok').subscribe();
    http.expectOne(`${base}/tok`).flush({ firstName: 'Ana' });
  });
});
