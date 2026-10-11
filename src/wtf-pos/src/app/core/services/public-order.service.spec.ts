import { ServiceErrorMessages } from '@core/messages';
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

  describe('createOrder', () => {
    const request = {
      items: [{ productId: 'p1', quantity: 2, addOns: [{ productId: 'a1', quantity: 1 }] }],
      fulfillment: 0,
      contactNumber: '0917 123 4567',
      paymentMethod: 1,
      amountReceived: 500,
    };

    it('posts the order to the link and returns it', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      const result = capture(service.createOrder('tok', request));

      const req = http.expectOne(`${base}/tok/orders`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(request);
      expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
      req.flush({ id: 'o1', orderNumber: 1042, statusKind: 'waiting' });

      expect(result.value).toMatchObject({ id: 'o1', orderNumber: 1042 });
    });

    it('never sends a price', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      service.createOrder('tok', request).subscribe();

      const body = JSON.stringify(http.expectOne(`${base}/tok/orders`).request.body);
      expect(body).not.toMatch(/price|total/i);
    });

    it('turns a 404 into the invalid link error', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      const errors: unknown[] = [];
      service.createOrder('tok', request).subscribe({ error: (e) => errors.push(e) });

      failWith(http.expectOne(`${base}/tok/orders`), 404);

      expect(errors[0]).toBeInstanceOf(PublicLinkInvalidError);
    });

    it("shows the server's plain explanation for a 400", () => {
      const { service, http } = setupHttpService(PublicOrderService);
      const result = capture(service.createOrder('tok', request));

      failWith(http.expectOne(`${base}/tok/orders`), 400, {
        message: 'The cash amount must be at least the order total of PHP 360.00.',
      });

      expect(result.error).toBe('The cash amount must be at least the order total of PHP 360.00.');
    });

    it('falls back to a plain message for other failures', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      const noMessage = capture(service.createOrder('tok', request));
      failWith(http.expectOne(`${base}/tok/orders`), 400);
      const server = capture(service.createOrder('tok', request));
      failWith(http.expectOne(`${base}/tok/orders`), 500);
      const limited = capture(service.createOrder('tok', request));
      failWith(http.expectOne(`${base}/tok/orders`), 429);
      const offline = capture(service.createOrder('tok', request));
      failNetwork(http.expectOne(`${base}/tok/orders`));

      expect(noMessage.error).toBe('Failed to place your order. Please try again.');
      expect(server.error).toBe('Failed to place your order. Please try again.');
      expect(limited.error).toContain('Too many requests');
      expect(offline.error).toContain('Unable to connect');
    });
  });

  describe('chat', () => {
    it('loads my conversations fresh', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      const result = capture(service.getConversations('tok-1'));

      const req = http.expectOne(`${base}/tok-1/conversations`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
      req.flush({ unreadConversations: 1, items: [] });

      expect(result.value).toEqual({ unreadConversations: 1, items: [] });
    });

    it('loads the chat of one of my orders', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      service.getOrderConversation('tok-1', 'o1').subscribe();

      const req = http.expectOne(`${base}/tok-1/orders/o1/messages`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
      req.flush({ orderId: 'o1', messages: [] });
    });

    it('sends only the text to the shop', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      service.sendMessage('tok-1', 'o1', 'Is 5pm ok?').subscribe();

      const req = http.expectOne(`${base}/tok-1/orders/o1/messages`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ body: 'Is 5pm ok?' });
      req.flush({ id: 'm1' });
    });

    it('marks the shop replies read', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      service.markConversationRead('tok-1', 'o1').subscribe();

      const req = http.expectOne(`${base}/tok-1/orders/o1/messages/read`);
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('turns a 404 on any chat call into the invalid link error', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      const list = capture(service.getConversations('tok-1'));
      failWith(http.expectOne(`${base}/tok-1/conversations`), 404);
      const chat = capture(service.getOrderConversation('tok-1', 'o1'));
      failWith(http.expectOne(`${base}/tok-1/orders/o1/messages`), 404);
      const send = capture(service.sendMessage('tok-1', 'o1', 'x'));
      failWith(http.expectOne(`${base}/tok-1/orders/o1/messages`), 404);
      const read = capture(service.markConversationRead('tok-1', 'o1'));
      failWith(http.expectOne(`${base}/tok-1/orders/o1/messages/read`), 404);

      for (const result of [list, chat, send, read]) {
        expect(result.error).toBe(new PublicLinkInvalidError().message);
      }
    });

    it('shows why a message was refused, and slows down on too many', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      const refused = capture(service.sendMessage('tok-1', 'o1', 'x'));
      failWith(http.expectOne(`${base}/tok-1/orders/o1/messages`), 400, {
        message: 'Please wait for the shop to reply before sending more messages.',
      });
      const slow = capture(service.sendMessage('tok-1', 'o1', 'x'));
      failWith(http.expectOne(`${base}/tok-1/orders/o1/messages`), 429);

      expect(refused.error).toBe('Please wait for the shop to reply before sending more messages.');
      expect(slow.error).toBe(ServiceErrorMessages.PublicOrder.TooManyRequests);
    });

    it('falls back to a plain message', () => {
      const { service, http } = setupHttpService(PublicOrderService);
      const chat = capture(service.getOrderConversation('tok-1', 'o1'));
      failWith(http.expectOne(`${base}/tok-1/orders/o1/messages`), 500);
      const send = capture(service.sendMessage('tok-1', 'o1', 'x'));
      failWith(http.expectOne(`${base}/tok-1/orders/o1/messages`), 500);

      expect(chat.error).toBe(ServiceErrorMessages.PublicOrder.ChatFailed);
      expect(send.error).toBe(ServiceErrorMessages.PublicOrder.SendMessageFailed);
    });
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
