import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { OrderLinkService } from './order-link.service';

afterEach(() => vi.restoreAllMocks());

describe('OrderLinkService', () => {
  const base = `${environment.apiUrl}/customers/c1`;

  it('lists the links of a customer', () => {
    const { service, http } = setupHttpService(OrderLinkService);
    const result = capture(service.getLinks('c1'));

    const req = http.expectOne(`${base}/ordering-links`);
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'l1', token: 't', status: 'Active' }]);

    expect(result.value).toEqual([{ id: 'l1', token: 't', status: 'Active' }]);
  });

  it('creates a link with an end date', () => {
    const { service, http } = setupHttpService(OrderLinkService);
    service.createLink('c1', '2026-12-31T00:00:00Z').subscribe();

    const req = http.expectOne(`${base}/ordering-links`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ expiresAt: '2026-12-31T00:00:00Z' });
  });

  it('creates a link without an end date by sending null', () => {
    const { service, http } = setupHttpService(OrderLinkService);
    service.createLink('c1').subscribe();

    expect(http.expectOne(`${base}/ordering-links`).request.body).toEqual({ expiresAt: null });
  });

  it('revokes a link', () => {
    const { service, http } = setupHttpService(OrderLinkService);
    service.revokeLink('c1', 'l1').subscribe();

    expect(http.expectOne(`${base}/ordering-links/l1`).request.method).toBe('DELETE');
  });

  it('enables and disables ordering', () => {
    const { service, http } = setupHttpService(OrderLinkService);
    service.setAccess('c1', true).subscribe();
    const on = http.expectOne(`${base}/ordering-link-access`);
    expect(on.request.method).toBe('PUT');
    expect(on.request.body).toEqual({ allow: true });

    service.setAccess('c1', false).subscribe();
    expect(http.expectOne(`${base}/ordering-link-access`).request.body).toEqual({ allow: false });
  });

  it('maps network failures and re-checks connectivity', () => {
    const { service, http, connectivity } = setupHttpService(OrderLinkService);
    const result = capture(service.getLinks('c1'));

    failNetwork(http.expectOne(`${base}/ordering-links`));

    expect(result.error).toContain('Unable to connect');
    expect(connectivity.checkNow).toHaveBeenCalled();
  });

  it('prefers the server message', () => {
    const { service, http } = setupHttpService(OrderLinkService);
    const result = capture(service.createLink('c1'));

    failWith(http.expectOne(`${base}/ordering-links`), 400, {
      message: 'Enable ordering for this customer before creating a link.',
    });

    expect(result.error).toBe('Enable ordering for this customer before creating a link.');
  });

  it('maps 403 and 404 and falls back otherwise', () => {
    const { service, http } = setupHttpService(OrderLinkService);

    const forbidden = capture(service.getLinks('c1'));
    failWith(http.expectOne(`${base}/ordering-links`), 403);
    const noCustomer = capture(service.getLinks('c1'));
    failWith(http.expectOne(`${base}/ordering-links`), 404);
    const noLink = capture(service.revokeLink('c1', 'l1'));
    failWith(http.expectOne(`${base}/ordering-links/l1`), 404);
    const noCustomerAccess = capture(service.setAccess('c1', true));
    failWith(http.expectOne(`${base}/ordering-link-access`), 404);
    const createFallback = capture(service.createLink('c1'));
    failWith(http.expectOne(`${base}/ordering-links`), 500);
    const revokeFallback = capture(service.revokeLink('c1', 'l1'));
    failWith(http.expectOne(`${base}/ordering-links/l1`), 500);
    const accessFallback = capture(service.setAccess('c1', false));
    failWith(http.expectOne(`${base}/ordering-link-access`), 500);
    const listFallback = capture(service.getLinks('c1'));
    failWith(http.expectOne(`${base}/ordering-links`), 500);

    expect(forbidden.error).toBe('Not authorized.');
    expect(noCustomer.error).toBe('Customer not found.');
    expect(noLink.error).toBe('Ordering link not found.');
    expect(noCustomerAccess.error).toBe('Customer not found.');
    expect(createFallback.error).toContain('Failed to create ordering link');
    expect(revokeFallback.error).toContain('Failed to revoke ordering link');
    expect(accessFallback.error).toContain('Failed to update ordering access');
    expect(listFallback.error).toContain('Failed to fetch ordering links');
  });
});
