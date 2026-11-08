import { environment } from '@environments/environment.development';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture, setupHttpService } from '../../testing/service-testing';
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
});
