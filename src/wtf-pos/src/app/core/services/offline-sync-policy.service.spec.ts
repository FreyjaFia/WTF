import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { OfflineSyncPolicyService } from './offline-sync-policy.service';

afterEach(() => vi.restoreAllMocks());

describe('OfflineSyncPolicyService', () => {
  const url = `${environment.apiUrl}/orders/sync-policy`;

  it('reads the policy with GET and saves it with PUT', () => {
    const { service, http } = setupHttpService(OfflineSyncPolicyService);

    service.get().subscribe();
    expect(http.expectOne(url).request.method).toBe('GET');

    const body = { codes: [{ code: 'PriceChanged', mode: 'Note' as const }], priceTolerance: 0, autoApproveNotes: false, agedAfterDays: 2 };
    service.save(body).subscribe();
    const put = http.expectOne(url);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(body);
  });

  it('shows the server message, the network message, or a fallback', () => {
    const { service, http, connectivity } = setupHttpService(OfflineSyncPolicyService);

    const server = capture(service.get());
    failWith(http.expectOne(url), 403, { message: 'Only the owner can change this.' });
    expect(server.error).toBe('Only the owner can change this.');

    const offline = capture(service.get());
    failNetwork(http.expectOne(url));
    expect(offline.error).toContain('Unable to connect');
    expect(connectivity.checkNow).toHaveBeenCalled();

    const fallback = capture(service.save({ codes: [], priceTolerance: 0, autoApproveNotes: false, agedAfterDays: 2 }));
    failWith(http.expectOne(url), 500);
    expect(fallback.error).toBe('Unable to save the offline sync policy.');
  });
});
