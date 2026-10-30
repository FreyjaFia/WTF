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

  it('reads the alert recipients of an item', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.getAlertRecipients('i1'));

    const req = http.expectOne(`${base}/i1/alert-recipients`);
    expect(req.request.method).toBe('GET');
    req.flush({ selectedUserIds: [], candidates: [], defaultDescription: 'Admins' });

    expect((result.value as { defaultDescription: string }).defaultDescription).toBe('Admins');
  });

  it('saves the alert recipients, and an empty list means the default', () => {
    const { service, http } = setupHttpService(InventoryService);
    service.setAlertRecipients('i1', ['u1', 'u2']).subscribe();
    const req = http.expectOne(`${base}/i1/alert-recipients`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ userIds: ['u1', 'u2'] });

    service.setAlertRecipients('i1', []).subscribe();
    expect(http.expectOne(`${base}/i1/alert-recipients`).request.body).toEqual({ userIds: [] });
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

  it('reads the recipe cost of a product', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.getProductRecipeCost('p1'));

    const req = http.expectOne(`${environment.apiUrl}/products/p1/recipe-cost`);
    expect(req.request.method).toBe('GET');
    req.flush({ productId: 'p1', lines: [], totalCost: 0 });

    expect((result.value as { productId: string }).productId).toBe('p1');
  });

  it('saves the size multiplier of an add-on', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.setRecipeMultiplier('p1', 1.5));

    const req = http.expectOne(`${environment.apiUrl}/products/p1/recipe-multiplier`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ multiplier: 1.5 });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(result.error).toBeUndefined();
  });

  it('gives the server message when the multiplier is refused', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.setRecipeMultiplier('p1', 20));

    http.expectOne(`${environment.apiUrl}/products/p1/recipe-multiplier`).flush(
      { message: 'Multiplier must be between 0.01 and 10.' },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(result.error).toBe('Multiplier must be between 0.01 and 10.');
  });

  it('gives a plain message when the recipe cost cannot be read', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.getProductRecipeCost('p1'));

    failWith(http.expectOne(`${environment.apiUrl}/products/p1/recipe-cost`), 403);

    expect(result.error).toBe('Unable to fetch the recipe cost.');
  });

  it('saves the supplies cost of a product', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.setSuppliesCost('p1', 2.5));

    const req = http.expectOne(`${environment.apiUrl}/products/p1/supplies-cost`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ amount: 2.5 });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(result.error).toBeUndefined();
  });

  it('gives the server message when the supplies cost is refused', () => {
    const { service, http } = setupHttpService(InventoryService);
    const result = capture(service.setSuppliesCost('p1', -1));

    http.expectOne(`${environment.apiUrl}/products/p1/supplies-cost`).flush(
      { message: 'Too low.' },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(result.error).toBe('Too low.');
  });
});
