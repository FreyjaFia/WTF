import { environment } from '@environments/environment.development';
import { StockCountDto, StockCountStatus } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { StockCountService } from './stock-count.service';

describe('StockCountService', () => {
  const url = `${environment.apiUrl}/stock-counts`;
  const count = { summary: { id: 'c1', status: StockCountStatus.Open }, lines: [] } as unknown as StockCountDto;

  it('lists the counts, optionally by status', () => {
    const { service, http } = setupHttpService(StockCountService);
    capture(service.getCounts());
    http.expectOne(url).flush([]);

    capture(service.getCounts(StockCountStatus.Posted));
    http.expectOne(`${url}?status=2`).flush([]);
  });

  it('starts a count with the chosen options', () => {
    const { service, http } = setupHttpService(StockCountService);
    const body = { name: 'Weekly', isBlind: true, note: null, itemIds: null };
    const result = capture(service.startCount(body));
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(count);

    expect(result.value).toEqual(count);
  });

  it('saves only the lines it is given', () => {
    const { service, http } = setupHttpService(StockCountService);
    capture(service.saveLines('c1', [{ itemId: 'i1', countedQuantity: 7 }]));
    const req = http.expectOne(`${url}/c1/lines`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ lines: [{ itemId: 'i1', countedQuantity: 7 }] });
    req.flush(count);
  });

  it('posts and cancels a count', () => {
    const { service, http } = setupHttpService(StockCountService);
    capture(service.postCount('c1'));
    expect(http.expectOne(`${url}/c1/post`).request.method).toBe('POST');

    capture(service.cancelCount('c1'));
    expect(http.expectOne(`${url}/c1/cancel`).request.method).toBe('POST');
  });

  it('passes the server refusal through', () => {
    const { service, http } = setupHttpService(StockCountService);
    const result = capture(service.postCount('c1'));
    failWith(http.expectOne(`${url}/c1/post`), 400, { message: 'This count is already closed.' });

    expect(result.error).toBe('This count is already closed.');
  });

  it('uses its own message for a server failure and a network message offline', () => {
    const { service, http } = setupHttpService(StockCountService);
    const failed = capture(service.getCount('c1'));
    failWith(http.expectOne(`${url}/c1`), 500);
    expect(failed.error).toBe('Unable to fetch the stock count.');

    const offline = capture(service.getCount('c1'));
    failNetwork(http.expectOne(`${url}/c1`));
    expect(offline.error).toBe('Unable to connect to server. Please check your connection.');
  });
});
