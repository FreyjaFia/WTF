import { TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment.development';
import { LeasePayload, SubscriptionDto } from '@shared/models/subscription.models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupHttpService } from '../../testing/service-testing';
import { SubscriptionService } from './subscription.service';

function encode(payload: LeasePayload): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${body}.c2ln`;
}

describe('SubscriptionService', () => {
  const url = `${environment.apiUrl}/subscription`;
  const payload = (over: Partial<LeasePayload> = {}): LeasePayload => ({
    v: 1,
    tenantId: 't',
    issuedAt: '2026-11-01T00:00:00Z',
    periodEnd: '2026-12-01T00:00:00Z',
    graceDays: 7,
    accessUntil: '2026-12-08T00:00:00Z',
    maxAgeDays: 7,
    ...over,
  });
  const dto = (lease: LeasePayload | null, serverTime: string): SubscriptionDto => ({
    managed: lease !== null,
    planName: 'Pro',
    planCode: 'pro',
    features: [],
    warning: 'none',
    daysLeft: 0,
    periodEnd: lease?.periodEnd ?? null,
    accessUntil: lease?.accessUntil ?? null,
    graceDays: 7,
    serverTime,
    lease: lease ? encode(lease) : null,
    leaseMaxAgeDays: 7,
  });

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('is open when the shop has no subscription', async () => {
    vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
    const { service, http } = setupHttpService(SubscriptionService);
    service.refresh();
    http.expectOne(url).flush(dto(null, '2026-11-10T00:00:00Z'));
    await vi.advanceTimersByTimeAsync(0);

    expect(service.access()).toBe('ok');
    expect(service.warning()).toBe('none');
  });

  it('warns in the last days of the period', async () => {
    vi.setSystemTime(new Date('2026-11-29T00:00:00Z'));
    const { service, http } = setupHttpService(SubscriptionService);
    service.refresh();
    http.expectOne(url).flush(dto(payload({ issuedAt: '2026-11-29T00:00:00Z' }), '2026-11-29T00:00:00Z'));
    await vi.advanceTimersByTimeAsync(0);

    expect(service.warning()).toBe('lastDays');
    expect(service.daysLeft()).toBe(2);
    expect(service.access()).toBe('ok');
  });

  it('locks after the grace period', async () => {
    vi.setSystemTime(new Date('2026-12-09T00:00:00Z'));
    const { service, http } = setupHttpService(SubscriptionService);
    service.refresh();
    http.expectOne(url).flush(dto(payload({ issuedAt: '2026-12-09T00:00:00Z' }), '2026-12-09T00:00:00Z'));
    await vi.advanceTimersByTimeAsync(0);

    expect(service.access()).toBe('locked');
  });

  it('asks for a connection when the lease is too old', async () => {
    vi.setSystemTime(new Date('2026-11-20T00:00:00Z'));
    const { service, http } = setupHttpService(SubscriptionService);
    service.refresh();
    http.expectOne(url).flush(dto(payload(), '2026-11-20T00:00:00Z'));
    await vi.advanceTimersByTimeAsync(0);

    expect(service.access()).toBe('needsOnline');
  });

  it('does not let a device clock set back undo the last time seen', async () => {
    vi.setSystemTime(new Date('2026-12-09T00:00:00Z'));
    const first = setupHttpService(SubscriptionService);
    first.service.refresh();
    first.http.expectOne(url).flush(dto(payload({ issuedAt: '2026-12-09T00:00:00Z' }), '2026-12-09T00:00:00Z'));
    await vi.advanceTimersByTimeAsync(0);

    TestBed.resetTestingModule();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const { service } = setupHttpService(SubscriptionService);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.access()).toBe('locked');
  });

  it('forgets a lease that is not valid', async () => {
    localStorage.setItem(SubscriptionService.STORAGE_KEY, JSON.stringify({ lease: 'garbage' }));
    const { service } = setupHttpService(SubscriptionService);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.leasePayload()).toBeNull();
    expect(localStorage.getItem(SubscriptionService.STORAGE_KEY)).toBeNull();
  });

  it('accepts a lease with no signature while the app has no public key', async () => {
    vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
    const { service, http } = setupHttpService(SubscriptionService);
    const unsigned = dto(payload(), '2026-11-10T00:00:00Z');
    unsigned.lease = unsigned.lease!.split('.')[0] + '.';
    service.refresh();
    http.expectOne(url).flush(unsigned);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.leasePayload()?.periodEnd).toBe('2026-12-01T00:00:00Z');
  });

  it('refreshes once a day, not every few minutes', async () => {
    vi.setSystemTime(new Date('2026-11-10T01:00:00Z'));
    const { service, http } = setupHttpService(SubscriptionService);
    service.start();
    http.expectOne(url).flush(dto(null, '2026-11-10T01:00:00Z'));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    http.expectNone(url);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    http.expectOne(url).flush(dto(null, '2026-11-11T02:00:00Z'));
    service.ngOnDestroy();
  });

  it('retries a failed refresh on the next tick and ignores parallel duplicates', async () => {
    vi.setSystemTime(new Date('2026-11-10T01:00:00Z'));
    const { service, http } = setupHttpService(SubscriptionService);
    service.start();
    service.refresh();
    http.expectOne(url).flush('x', { status: 500, statusText: 'err' });

    await vi.advanceTimersByTimeAsync(60 * 1000);
    http.expectOne(url).flush(dto(null, '2026-11-10T01:01:00Z'));

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    http.expectNone(url);
    service.ngOnDestroy();
  });
});
