import { environment } from '@environments/environment.development';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capture, setupHttpService } from '../../testing/service-testing';
import { db } from './db';
import { localDataWiped$ } from './local-data-events';
import { PlatformService } from './platform.service';

function tokenExpiringIn(seconds: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }));

  return `h.${payload}.s`;
}

describe('PlatformService', () => {
  const base = `${environment.apiUrl}/platform`;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps the platform token in the session only after login', () => {
    const { service, http } = setupHttpService(PlatformService);
    const result = capture(service.login('boss', 'pw'));

    const req = http.expectOne(`${base}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'boss', password: 'pw' });
    req.flush({ accessToken: 'abc' });

    expect(result.emissions).toBe(1);
    expect(sessionStorage.getItem('platformToken')).toBe('abc');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('is signed in only with an unexpired token', () => {
    const { service } = setupHttpService(PlatformService);

    expect(service.isSignedIn()).toBe(false);

    sessionStorage.setItem('platformToken', tokenExpiringIn(-10));
    expect(service.isSignedIn()).toBe(false);

    sessionStorage.setItem('platformToken', tokenExpiringIn(600));
    expect(service.isSignedIn()).toBe(true);

    sessionStorage.setItem('platformToken', 'garbage');
    expect(service.isSignedIn()).toBe(false);

    service.logout();
    expect(service.getToken()).toBeNull();
  });

  it('asks for each shop action on its own route', () => {
    const { service, http } = setupHttpService(PlatformService);

    service.getTenants().subscribe();
    expect(http.expectOne(`${base}/tenants`).request.method).toBe('GET');

    service.changeStatus('t1', 'suspend', 'unpaid').subscribe();
    const status = http.expectOne(`${base}/tenants/t1/suspend`);
    expect(status.request.body).toEqual({ reason: 'unpaid' });

    service.resetPassword('t1', 'u1').subscribe();
    expect(http.expectOne(`${base}/tenants/t1/users/u1/reset-password`).request.method).toBe('POST');

    service.impersonate('t1', 'u1', 'help the owner', false).subscribe();
    expect(http.expectOne(`${base}/tenants/t1/users/u1/impersonate`).request.body).toEqual({
      reason: 'help the owner',
      allowWrites: false,
    });

    service.deleteTenant('t1', 'slug', 'pw').subscribe();
    expect(http.expectOne(`${base}/tenants/t1/delete`).request.body).toEqual({ slug: 'slug', adminPassword: 'pw' });

    service.getAuditLogs('t1').subscribe();
    expect(http.expectOne(`${base}/audit-logs?tenantId=t1`).request.method).toBe('GET');
  });

  it('replaces the shop session when signing in as a person, and leaving removes it', () => {
    const { service } = setupHttpService(PlatformService);
    localStorage.setItem('refreshToken', 'old');

    service.startImpersonation({
      accessToken: 'imp',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      username: 'owner',
      tenantName: 'Moon',
      readOnly: true,
    });

    expect(localStorage.getItem('token')).toBe('imp');
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(service.getImpersonation()?.username).toBe('owner');

    service.endImpersonation();
    expect(localStorage.getItem('token')).toBeNull();
    expect(service.getImpersonation()).toBeNull();
  });

  it('drops an expired impersonation and its shop token', () => {
    const { service } = setupHttpService(PlatformService);
    localStorage.setItem('token', 'imp');
    localStorage.setItem(
      'impersonation',
      JSON.stringify({ expiresAt: new Date(Date.now() - 1000).toISOString(), username: 'o', tenantName: 'M', readOnly: true }),
    );

    expect(service.getImpersonation()).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  describe('local shop data around a sign-in as a shop', () => {
    const shopToken = (): string => {
      const payload = btoa(JSON.stringify({ sub: 'Owner-1', tenant_id: 'BBBBBBBB-0000-0000-0000-000000000002' }));

      return `h.${payload}.s`;
    };
    const dto = {
      accessToken: '',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      username: 'owner',
      tenantName: 'Brew Bar',
      readOnly: true,
    };

    beforeEach(() => {
      vi.spyOn(db.carts, 'clear').mockResolvedValue(undefined as never);
      vi.spyOn(db.catalog, 'clear').mockResolvedValue(undefined as never);
      vi.spyOn(db.images, 'clear').mockResolvedValue(undefined as never);
      localStorage.setItem('wtf_active_branch', '11111111-1111-4111-8111-111111111111');
      localStorage.setItem('wtf_my_branches', '{}');
      localStorage.setItem('wtf_me_cache', '{}');
    });

    afterEach(() => vi.restoreAllMocks());

    it('forgets the branch, cart, menu and profile of the last session when it starts', () => {
      const { service } = setupHttpService(PlatformService);
      const wiped = vi.fn();
      const subscription = localDataWiped$.subscribe(wiped);

      service.startImpersonation({ ...dto, accessToken: shopToken() });
      subscription.unsubscribe();

      expect(localStorage.getItem('wtf_active_branch')).toBeNull();
      expect(localStorage.getItem('wtf_my_branches')).toBeNull();
      expect(localStorage.getItem('wtf_me_cache')).toBeNull();
      expect(db.carts.clear).toHaveBeenCalled();
      expect(db.catalog.clear).toHaveBeenCalled();
      expect(wiped).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('wtf-device-tenant')).toBe('bbbbbbbb-0000-0000-0000-000000000002');
      expect(localStorage.getItem('wtf-device-user')).toBe('owner-1');
    });

    it('forgets what the shop left on the device when it ends', () => {
      const { service } = setupHttpService(PlatformService);
      service.startImpersonation({ ...dto, accessToken: shopToken() });
      localStorage.setItem('wtf_active_branch', '22222222-2222-4222-8222-222222222222');
      vi.mocked(db.carts.clear).mockClear();

      service.endImpersonation();

      expect(localStorage.getItem('wtf_active_branch')).toBeNull();
      expect(db.carts.clear).toHaveBeenCalled();
      expect(localStorage.getItem('token')).toBeNull();
    });
  });
});
