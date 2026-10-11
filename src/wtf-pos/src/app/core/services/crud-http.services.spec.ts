import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capture,
  failNetwork,
  failWith,
  setupHttpService,
} from '../../testing/service-testing';
import { CustomerService } from './customer.service';
import { InventoryService } from './inventory.service';

afterEach(() => vi.restoreAllMocks());

describe('CustomerService', () => {
  const base = `${environment.apiUrl}/customers`;

  it('lists customers with optional filters', () => {
    const { service, http } = setupHttpService(CustomerService);
    service.getCustomers({ searchTerm: 'ana', isActive: false }).subscribe();

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('searchTerm')).toBe('ana');
    expect(req.request.params.get('isActive')).toBe('false');
    req.flush([]);
  });

  it('omits empty filters', () => {
    const { service, http } = setupHttpService(CustomerService);
    service.getCustomers({ searchTerm: '', isActive: null }).subscribe();

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
  });

  it('calls the right endpoint and verb for each operation', () => {
    const { service, http } = setupHttpService(CustomerService);
    const file = new File(['x'], 'a.png');

    service.getCustomer('1').subscribe();
    expect(http.expectOne(`${base}/1`).request.method).toBe('GET');

    service.createCustomer({ firstName: 'A' } as never).subscribe();
    const create = http.expectOne(base);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ firstName: 'A' });

    service.updateCustomer({ id: '2', firstName: 'B' } as never).subscribe();
    const update = http.expectOne(`${base}/2`);
    expect(update.request.method).toBe('PUT');

    service.deleteCustomer('3').subscribe();
    expect(http.expectOne(`${base}/3`).request.method).toBe('DELETE');

    service.restoreCustomer('4').subscribe();
    const restore = http.expectOne(`${base}/4/restore`);
    expect(restore.request.method).toBe('POST');

    service.uploadCustomerImage('5', file).subscribe();
    const upload = http.expectOne(`${base}/5/image`);
    expect(upload.request.method).toBe('POST');
    expect((upload.request.body as FormData).get('file')).toBeInstanceOf(File);

    service.deleteCustomerImage('6').subscribe();
    expect(http.expectOne(`${base}/6/image`).request.method).toBe('DELETE');
  });

  it('maps network failures and re-checks connectivity', () => {
    const { service, http, connectivity } = setupHttpService(CustomerService);
    const result = capture(service.getCustomer('1'));

    failNetwork(http.expectOne(`${base}/1`));

    expect(result.error).toContain('Unable to connect');
    expect(connectivity.checkNow).toHaveBeenCalled();
  });

  it('prefers the server message over status-specific text', () => {
    const { service, http } = setupHttpService(CustomerService);
    const result = capture(service.getCustomer('1'));

    failWith(http.expectOne(`${base}/1`), 404, { message: 'Gone' });

    expect(result.error).toBe('Gone');
  });

  it('maps 403 and 404 and falls back otherwise', () => {
    const { service, http } = setupHttpService(CustomerService);
    const forbidden = capture(service.getCustomers());
    failWith(http.expectOne((r) => r.url === base), 403);
    const notFound = capture(service.getCustomer('1'));
    failWith(http.expectOne(`${base}/1`), 404);
    const imageNotFound = capture(service.deleteCustomerImage('1'));
    failWith(http.expectOne(`${base}/1/image`), 404);
    const fallback = capture(service.createCustomer({} as never));
    failWith(http.expectOne(base), 500);
    const create404 = capture(service.createCustomer({} as never));
    failWith(http.expectOne(base), 404);

    expect(forbidden.error).toBe('Not authorized.');
    expect(notFound.error).toBe('Customer not found.');
    expect(imageNotFound.error).toBe('Customer or image not found.');
    expect(fallback.error).toBe('Failed to create customer. Please try again later.');
    // create has no notFound mapping, so 404 uses the fallback.
    expect(create404.error).toBe('Failed to create customer. Please try again later.');
  });
});

describe('InventoryService', () => {
  const base = `${environment.apiUrl}/items`;

  it('lists items with optional filters', () => {
    const { service, http } = setupHttpService(InventoryService);
    service
      .getInventoryItems({ searchTerm: 'milk', isActive: true, includeInactive: false })
      .subscribe();

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('searchTerm')).toBe('milk');
    expect(req.request.params.get('isActive')).toBe('true');
    expect(req.request.params.get('includeInactive')).toBe('false');
    req.flush([]);
  });

  it('omits unset filters', () => {
    const { service, http } = setupHttpService(InventoryService);
    service.getInventoryItems().subscribe();

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
  });

  it('calls the right endpoint and verb for each operation', () => {
    const { service, http } = setupHttpService(InventoryService);

    service.getInventoryItem('1').subscribe();
    expect(http.expectOne(`${base}/1`).request.method).toBe('GET');

    service.createInventoryItem({ name: 'x' } as never).subscribe();
    expect(http.expectOne(base).request.method).toBe('POST');

    service.updateInventoryItem({ id: '2' } as never).subscribe();
    expect(http.expectOne(`${base}/2`).request.method).toBe('PUT');

    service.addStock({ itemId: '3', quantity: 5 } as never).subscribe();
    const stock = http.expectOne(`${base}/3/stock`);
    expect(stock.request.method).toBe('POST');
    expect(stock.request.body).toEqual({ itemId: '3', quantity: 5 });

    service.assignProductItemLinks('4', [{ productId: 'p', quantityPerSale: 1 }] as never).subscribe();
    const links = http.expectOne(`${base}/4/product-links`);
    expect(links.request.method).toBe('PUT');
    expect(links.request.body).toEqual({
      itemId: '4',
      productLinks: [{ productId: 'p', quantityPerSale: 1 }],
    });

    service.deleteInventoryItem('5').subscribe();
    expect(http.expectOne(`${base}/5`).request.method).toBe('DELETE');

    service.restoreInventoryItem('6').subscribe();
    expect(http.expectOne(`${base}/6/restore`).request.method).toBe('POST');
  });

  it('uses the server message when present, otherwise the per-call fallback', () => {
    const { service, http } = setupHttpService(InventoryService);
    const server = capture(service.getInventoryItem('1'));
    failWith(http.expectOne(`${base}/1`), 400, { message: 'SKU taken' });
    const fallback = capture(service.addStock({ itemId: '1' } as never));
    failWith(http.expectOne(`${base}/1/stock`), 500);

    expect(server.error).toBe('SKU taken');
    expect(fallback.error).toBe('Unable to add stock.');
  });

  it('reports network loss and re-checks connectivity', () => {
    const { service, http, connectivity } = setupHttpService(InventoryService);
    const result = capture(service.deleteInventoryItem('1'));

    failNetwork(http.expectOne(`${base}/1`));

    expect(result.error).toBe('Network unavailable. Please check your connection.');
    expect(connectivity.checkNow).toHaveBeenCalled();
  });
});
