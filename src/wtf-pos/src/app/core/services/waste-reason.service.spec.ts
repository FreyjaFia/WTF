import { environment } from '@environments/environment.development';
import { WasteReasonDto } from '@shared/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { WasteReasonService } from './waste-reason.service';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WasteReasonService', () => {
  const url = `${environment.apiUrl}/waste-reasons`;
  const reason: WasteReasonDto = {
    id: 3,
    name: 'Spilled',
    requiresNote: false,
    sortOrder: 2,
    isActive: true,
    isSystem: false,
  };
  const save = { name: 'Spilled', requiresNote: true, sortOrder: 5 };

  it('lists active reasons by default', () => {
    const { service, http } = setupHttpService(WasteReasonService);
    const result = capture(service.getReasons());
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('includeInactive')).toBe('false');
    req.flush([reason]);

    expect(result.value).toEqual([reason]);
    http.verify();
  });

  it('can include inactive reasons', () => {
    const { service, http } = setupHttpService(WasteReasonService);
    capture(service.getReasons(true));
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('includeInactive')).toBe('true');
    req.flush([]);
    http.verify();
  });

  it('creates a reason with a POST of the form', () => {
    const { service, http } = setupHttpService(WasteReasonService);
    const result = capture(service.createReason(save));
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(save);
    req.flush(reason);

    expect(result.value).toEqual(reason);
  });

  it('updates a reason with a PUT to its id', () => {
    const { service, http } = setupHttpService(WasteReasonService);
    capture(service.updateReason(3, save));
    const req = http.expectOne(`${url}/3`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(save);
    req.flush(reason);
  });

  it('turns a reason off and restores it with POSTs', () => {
    const { service, http } = setupHttpService(WasteReasonService);
    capture(service.deactivateReason(3));
    const off = http.expectOne(`${url}/3/deactivate`);
    expect(off.request.method).toBe('POST');
    off.flush(reason);

    capture(service.restoreReason(3));
    const on = http.expectOne(`${url}/3/restore`);
    expect(on.request.method).toBe('POST');
    on.flush(reason);
    http.verify();
  });

  it('passes the server message on a refusal', () => {
    const { service, http } = setupHttpService(WasteReasonService);
    const result = capture(service.deactivateReason(1));
    failWith(http.expectOne(`${url}/1/deactivate`), 400, { message: 'A system reason cannot be turned off.' });

    expect(result.error).toBe('A system reason cannot be turned off.');
  });

  it('falls back to its own message when the server gives none', () => {
    const { service, http } = setupHttpService(WasteReasonService);
    const created = capture(service.createReason(save));
    failWith(http.expectOne(url), 500);
    const updated = capture(service.updateReason(2, save));
    failWith(http.expectOne(`${url}/2`), 500);
    const restored = capture(service.restoreReason(2));
    failWith(http.expectOne(`${url}/2/restore`), 500);
    const listed = capture(service.getReasons());
    failWith(http.expectOne((r) => r.url === url), 500);

    expect(created.error).toBe('Unable to add the waste reason.');
    expect(updated.error).toBe('Unable to save the waste reason.');
    expect(restored.error).toBe('Unable to restore the waste reason.');
    expect(listed.error).toBe('Unable to fetch the waste reasons.');
  });

  it('reports a network failure and asks for a connection check', () => {
    const { service, http, connectivity } = setupHttpService(WasteReasonService);
    const result = capture(service.getReasons());
    failNetwork(http.expectOne((r) => r.url === url));

    expect(result.error).toBe('Network unavailable. Please check your connection.');
    expect(connectivity.checkNow).toHaveBeenCalledOnce();
  });
});
