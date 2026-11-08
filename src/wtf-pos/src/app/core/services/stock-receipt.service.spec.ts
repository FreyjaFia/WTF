import { environment } from '@environments/environment.development';
import { RecordStockReceiptDto, StockReceiptDto } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { capture, failWith, setupHttpService } from '../../testing/service-testing';
import { StockReceiptService } from './stock-receipt.service';

describe('StockReceiptService', () => {
  const url = `${environment.apiUrl}/stock-receipts`;
  const receipt = { summary: { id: 'r1' }, lines: [] } as unknown as StockReceiptDto;
  const payload: RecordStockReceiptDto = {
    supplierId: 's1',
    receivedOn: '2026-11-08',
    invoiceNumber: 'INV-1',
    invoiceTotal: 1680,
    note: null,
    clientRequestId: 'c1',
    lines: [{ itemId: 'i1', packs: 2, unitsPerPack: 12, packPrice: 840, packName: 'carton' }],
  };

  it('lists receipts, optionally for one supplier or a search', () => {
    const { service, http } = setupHttpService(StockReceiptService);
    capture(service.getReceipts());
    http.expectOne(url).flush([]);

    capture(service.getReceipts({ supplierId: 's1', search: 'INV' }));
    http.expectOne(`${url}?supplierId=s1&search=INV`).flush([]);
  });

  it('gets one receipt', () => {
    const { service, http } = setupHttpService(StockReceiptService);
    const result = capture(service.getReceipt('r1'));
    http.expectOne(`${url}/r1`).flush(receipt);

    expect(result.value).toEqual(receipt);
  });

  it('records a receipt with its lines', () => {
    const { service, http } = setupHttpService(StockReceiptService);
    const result = capture(service.recordReceipt(payload));
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(receipt);

    expect(result.value).toEqual(receipt);
  });

  it('reports the server message', () => {
    const { service, http } = setupHttpService(StockReceiptService);
    const result = capture(service.recordReceipt(payload));
    failWith(http.expectOne(url), 400, 'Add at least one item to the receipt.');

    expect(result.error).toContain('Add at least one item');
  });
});
