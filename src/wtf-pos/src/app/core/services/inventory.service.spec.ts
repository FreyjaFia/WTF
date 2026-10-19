import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { InventoryService } from './inventory.service';

afterEach(() => vi.restoreAllMocks());

describe('InventoryService', () => {
  const base = `${environment.apiUrl}/items`;

  it('adds stock with the cost and note', () => {
    const { service, http } = setupHttpService(InventoryService);
    service.addStock({ itemId: 'i1', quantity: 5, unitCost: 2, notes: 'delivery' }).subscribe();

    const req = http.expectOne(`${base}/i1/stock`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ itemId: 'i1', quantity: 5, unitCost: 2, notes: 'delivery' });
  });

  it('posts a stock adjustment to its own route', () => {
    const { service, http } = setupHttpService(InventoryService);
    const payload = { itemId: 'i1', countedQuantity: 7, expectedQuantity: 10, reason: 'Lost' };
    service.adjustStock(payload).subscribe();

    const req = http.expectOne(`${base}/i1/stock/adjust`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
  });

  it('asks for a page of movements, filtered by type', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.getItemMovements('i1', { type: 'Sale', page: 2, pageSize: 25 }));

    const req = http.expectOne((r) => r.url === `${base}/i1/movements`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('type')).toBe('Sale');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    req.flush({ items: [], totalCount: 0 });

    expect(result.value).toEqual({ items: [], totalCount: 0 });
  });

  it('leaves the filters out when none are given', () => {
    const { service, http } = setupHttpService(InventoryService);
    service.getItemMovements('i1').subscribe();

    const req = http.expectOne((r) => r.url === `${base}/i1/movements`);
    expect(req.request.params.keys()).toEqual([]);
  });

  it('lists the stock movements of an order', () => {
    const { service, http } = setupHttpService(InventoryService);
    service.getOrderStockMovements('o1').subscribe();

    const req = http.expectOne(`${environment.apiUrl}/orders/o1/stock-movements`);
    expect(req.request.method).toBe('GET');
  });

  it('asks for the stock coverage of the products', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.getStockCoverage());

    const req = http.expectOne(`${base}/coverage`);
    expect(req.request.method).toBe('GET');
    req.flush({ covered: 1, partial: 0, missing: 0, products: [] });

    expect(result.value).toEqual({ covered: 1, partial: 0, missing: 0, products: [] });
  });

  it('links a product to an item with the quantity taken per sale', () => {
    const { service, http } = setupHttpService(InventoryService);
    service.linkProductToItem('p1', 'i1', 200).subscribe();

    const req = http.expectOne(`${base}/product-links`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ productId: 'p1', itemId: 'i1', quantityPerSale: 200 });
  });

  it('prefers the server message, for example a refused adjustment', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(
      service.adjustStock({ itemId: 'i1', quantityChange: -5, reason: 'Lost' }),
    );

    failWith(http.expectOne(`${base}/i1/stock/adjust`), 400, {
      message: 'This item does not allow a negative balance, so the adjustment would take it below zero.',
    });

    expect(result.error).toContain('negative balance');
  });

  it('maps a network failure and re-checks connectivity', () => {
    const { service, http, connectivity } = setupHttpService(InventoryService);
    const result = capture(service.getOrderStockMovements('o1'));

    failNetwork(http.expectOne(`${environment.apiUrl}/orders/o1/stock-movements`));

    expect(result.error).toBe('Network unavailable. Please check your connection.');
    expect(connectivity.checkNow).toHaveBeenCalled();
  });

  it('falls back to a plain message when the server sends none', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.getItemMovements('i1'));

    failWith(http.expectOne((r) => r.url === `${base}/i1/movements`), 500);

    expect(result.error).toBe('Unable to fetch stock history.');
  });
});
