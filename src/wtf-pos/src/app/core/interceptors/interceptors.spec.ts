import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ServiceErrorMessages } from '@core/messages';
import { AlertService, AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { SubscriptionService } from '../services/subscription.service';
import { subscriptionInterceptor } from './subscription.interceptor';
import { timezoneInterceptor } from './timezone.interceptor';
import { utcDateInterceptor } from './utc-date.interceptor';

function setup(interceptors: Parameters<typeof withInterceptors>[0], providers: unknown[] = []) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors(interceptors)),
      provideHttpClientTesting(),
      ...(providers as never[]),
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
  };
}

describe('authInterceptor', () => {
  let auth: { getToken: ReturnType<typeof vi.fn>; refreshToken: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
  let alerts: { error: ReturnType<typeof vi.fn> };
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let ctrl: HttpTestingController;
  let http: HttpClient;

  beforeEach(() => {
    auth = { getToken: vi.fn().mockReturnValue('tok'), refreshToken: vi.fn(), logout: vi.fn() };
    router = { navigateByUrl: vi.fn() };
    alerts = { error: vi.fn() };
    ({ http, ctrl } = setup([authInterceptor], [
      { provide: AlertService, useValue: alerts },
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
    ]));
  });

  afterEach(() => ctrl.verify());

  it('signs a person out with the message from the API when their shop is suspended', () => {
    http.get('/api/orders').subscribe({ error: () => undefined });

    ctrl.expectOne('/api/orders').flush(
      { message: ServiceErrorMessages.Auth.ShopSuspended },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(auth.logout).toHaveBeenCalled();
    expect(alerts.error).toHaveBeenCalledWith(ServiceErrorMessages.Auth.ShopSuspended);
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Login, { replaceUrl: true });
  });

  it('keeps the session on a 403 that is not about a suspended shop', () => {
    http.get('/api/orders').subscribe({ error: () => undefined });

    ctrl.expectOne('/api/orders').flush({ message: 'This session is read-only.' }, { status: 403, statusText: 'Forbidden' });

    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('attaches the bearer token', () => {
    http.get('/api/orders').subscribe();

    const req = ctrl.expectOne('/api/orders');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    req.flush({});
  });

  it('never attaches the staff token to public ordering calls', () => {
    http.get('/api/public/order-links/abc').subscribe();

    const req = ctrl.expectOne('/api/public/order-links/abc');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('does not refresh the session or redirect when a public ordering call fails with 401', () => {
    let failed = false;
    http.get('/api/public/order-links/abc').subscribe({ error: () => (failed = true) });

    ctrl.expectOne('/api/public/order-links/abc').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(failed).toBe(true);
    expect(auth.refreshToken).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('does not override an existing Authorization header', () => {
    http.get('/api/orders', { headers: { Authorization: 'Custom x' } }).subscribe();

    const req = ctrl.expectOne('/api/orders');
    expect(req.request.headers.get('Authorization')).toBe('Custom x');
    req.flush({});
  });

  it('sends no Authorization header when there is no token', () => {
    auth.getToken.mockReturnValue(null);
    http.get('/api/orders').subscribe();

    const req = ctrl.expectOne('/api/orders');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it.each(['/api/auth/login', '/api/auth/refresh'])('skips auth endpoint %s', (url) => {
    const errors: unknown[] = [];
    http.post(url, {}).subscribe({ error: (e) => errors.push(e) });

    const req = ctrl.expectOne(url);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush('bad', { status: 401, statusText: 'Unauthorized' });

    expect(auth.refreshToken).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });

  it('refreshes on 401 and retries once with the new token', () => {
    auth.getToken.mockReturnValueOnce('old').mockReturnValue('new');
    auth.refreshToken.mockReturnValue(of({}));
    const results: unknown[] = [];

    http.get('/api/orders').subscribe((r) => results.push(r));
    ctrl.expectOne('/api/orders').flush('', { status: 401, statusText: 'Unauthorized' });

    const retry = ctrl.expectOne('/api/orders');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new');
    expect(retry.request.headers.get('X-Refresh-Attempted')).toBe('true');
    retry.flush({ ok: true });
    expect(results).toEqual([{ ok: true }]);
  });

  it('logs out and redirects to login when refresh fails', () => {
    auth.refreshToken.mockReturnValue(throwError(() => new Error('x')));
    const errors: Error[] = [];

    http.get('/api/orders').subscribe({ error: (e) => errors.push(e) });
    ctrl.expectOne('/api/orders').flush('', { status: 401, statusText: 'Unauthorized' });

    expect(auth.logout).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.Login, { replaceUrl: true });
    expect(errors[0].message).toBe(ServiceErrorMessages.Auth.SessionExpired);
  });

  it('keeps the session when the refresh fails because the network is down', () => {
    const networkError = new HttpErrorResponse({ status: 0 });
    auth.refreshToken.mockReturnValue(throwError(() => networkError));
    const errors: unknown[] = [];

    http.get('/api/orders').subscribe({ error: (e) => errors.push(e) });
    ctrl.expectOne('/api/orders').flush('', { status: 401, statusText: 'Unauthorized' });

    expect(auth.logout).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(errors[0]).toBe(networkError);
  });

  it('does not refresh again for an already retried request', () => {
    const errors: unknown[] = [];

    http
      .get('/api/orders', { headers: { 'X-Refresh-Attempted': 'true' } })
      .subscribe({ error: (e) => errors.push(e) });
    ctrl.expectOne('/api/orders').flush('', { status: 401, statusText: 'Unauthorized' });

    expect(auth.refreshToken).not.toHaveBeenCalled();
    expect((errors[0] as HttpErrorResponse).status).toBe(401);
  });

  it('passes non-401 errors through untouched', () => {
    const errors: HttpErrorResponse[] = [];

    http.get('/api/orders').subscribe({ error: (e) => errors.push(e) });
    ctrl.expectOne('/api/orders').flush('', { status: 500, statusText: 'Server Error' });

    expect(auth.refreshToken).not.toHaveBeenCalled();
    expect(errors[0].status).toBe(500);
  });

  it('rejects with the original error when the refreshed token is unavailable', () => {
    auth.getToken.mockReturnValueOnce('old').mockReturnValue(null);
    auth.refreshToken.mockReturnValue(of({}));
    const errors: unknown[] = [];

    http.get('/api/orders').subscribe({ error: (e) => errors.push(e) });
    ctrl.expectOne('/api/orders').flush('', { status: 401, statusText: 'Unauthorized' });

    expect(auth.logout).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect((errors[0] as HttpErrorResponse).status).toBe(401);
  });

  it.each([0, 400, 403, 500])('keeps the session when the retried request fails with %s', (status) => {
    auth.getToken.mockReturnValueOnce('old').mockReturnValue('new');
    auth.refreshToken.mockReturnValue(of({}));
    const errors: HttpErrorResponse[] = [];

    http.get('/api/orders').subscribe({ error: (e) => errors.push(e) });
    ctrl.expectOne('/api/orders').flush('', { status: 401, statusText: 'Unauthorized' });
    ctrl.expectOne('/api/orders').flush('', { status, statusText: 'Failed' });

    expect(auth.logout).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(errors[0].status).toBe(status);
  });
});

describe('timezoneInterceptor', () => {
  let ctrl: HttpTestingController;
  let http: HttpClient;

  beforeEach(() => {
    ({ http, ctrl } = setup([timezoneInterceptor]));
  });

  afterEach(() => ctrl.verify());

  it('adds X-TimeZone to API requests', () => {
    http.get('https://host/api/orders').subscribe();

    const req = ctrl.expectOne('https://host/api/orders');
    expect(req.request.headers.get('X-TimeZone')).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    );
    req.flush({});
  });

  it('handles relative /api urls', () => {
    http.get('/api/x').subscribe();

    const req = ctrl.expectOne('/api/x');
    expect(req.request.headers.has('X-TimeZone')).toBe(true);
    req.flush({});
  });

  it('leaves non-API requests alone', () => {
    http.get('https://cdn.example.com/file.json').subscribe();

    const req = ctrl.expectOne('https://cdn.example.com/file.json');
    expect(req.request.headers.has('X-TimeZone')).toBe(false);
    req.flush({});
  });

  it('keeps a caller-provided X-TimeZone', () => {
    http.get('/api/x', { headers: { 'X-TimeZone': 'Asia/Manila' } }).subscribe();

    const req = ctrl.expectOne('/api/x');
    expect(req.request.headers.get('X-TimeZone')).toBe('Asia/Manila');
    req.flush({});
  });
});

describe('utcDateInterceptor', () => {
  let ctrl: HttpTestingController;
  let http: HttpClient;

  beforeEach(() => {
    ({ http, ctrl } = setup([utcDateInterceptor]));
  });

  afterEach(() => ctrl.verify());

  it('appends Z to timezone-less ISO timestamps, recursively', () => {
    let body: unknown;
    http.get('/x').subscribe((b) => (body = b));

    ctrl.expectOne('/x').flush({
      createdAt: '2025-01-01T10:00:00',
      precise: '2025-01-01T10:00:00.123',
      nested: { list: [{ at: '2025-02-02T00:00:00' }] },
    });

    expect(body).toEqual({
      createdAt: '2025-01-01T10:00:00Z',
      precise: '2025-01-01T10:00:00.123Z',
      nested: { list: [{ at: '2025-02-02T00:00:00Z' }] },
    });
  });

  it('leaves already-zoned timestamps and other strings untouched', () => {
    let body: unknown;
    http.get('/x').subscribe((b) => (body = b));

    ctrl.expectOne('/x').flush({
      utc: '2025-01-01T10:00:00Z',
      offset: '2025-01-01T10:00:00+08:00',
      dateOnly: '2025-01-01',
      name: 'hello',
      count: 3,
      flag: true,
      nothing: null,
    });

    expect(body).toEqual({
      utc: '2025-01-01T10:00:00Z',
      offset: '2025-01-01T10:00:00+08:00',
      dateOnly: '2025-01-01',
      name: 'hello',
      count: 3,
      flag: true,
      nothing: null,
    });
  });

  it('normalizes top-level arrays', () => {
    let body: unknown;
    http.get('/x').subscribe((b) => (body = b));

    ctrl.expectOne('/x').flush(['2025-01-01T10:00:00']);

    expect(body).toEqual(['2025-01-01T10:00:00Z']);
  });

  it('does not touch blob responses', async () => {
    let body: unknown;
    http.get('/x', { responseType: 'blob' }).subscribe((b) => (body = b));

    const blob = new Blob(['2025-01-01T10:00:00']);
    ctrl.expectOne('/x').flush(blob);

    expect(body).toBe(blob);
  });
});

describe('authInterceptor on platform calls', () => {
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let ctrl: HttpTestingController;
  let http: HttpClient;

  beforeEach(() => {
    sessionStorage.clear();
    router = { navigateByUrl: vi.fn() };
    const auth = { getToken: vi.fn().mockReturnValue('shop-token'), refreshToken: vi.fn(), logout: vi.fn() };
    ({ http, ctrl } = setup([authInterceptor], [
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
    ]));
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('sends the platform token, never the shop token', () => {
    sessionStorage.setItem('platformToken', 'platform-token');
    http.get('/api/platform/tenants').subscribe();

    const req = ctrl.expectOne('/api/platform/tenants');
    expect(req.request.headers.get('Authorization')).toBe('Bearer platform-token');
    req.flush([]);
  });

  it('sends no token to the platform login', () => {
    http.post('/api/platform/auth/login', {}).subscribe();

    const req = ctrl.expectOne('/api/platform/auth/login');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('returns to the platform login on 401 without trying the shop refresh', () => {
    sessionStorage.setItem('platformToken', 'platform-token');
    http.get('/api/platform/tenants').subscribe({ error: () => undefined });

    ctrl.expectOne('/api/platform/tenants').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(sessionStorage.getItem('platformToken')).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.PlatformLogin, { replaceUrl: true });
  });
});

describe('subscriptionInterceptor', () => {
  let ctrl: HttpTestingController;
  let http: HttpClient;
  const subscription = { refresh: vi.fn(), lastOnline: vi.fn() };

  beforeEach(() => {
    subscription.refresh.mockReset();
    subscription.lastOnline.mockReset().mockReturnValue('2026-11-08T01:00:00.000Z');
    ({ http, ctrl } = setup([subscriptionInterceptor], [{ provide: SubscriptionService, useValue: subscription }]));
  });

  afterEach(() => ctrl.verify());

  it('tells the server when the device was last online on offline order sync', () => {
    http.post('/api/orders/sync', {}).subscribe();

    const req = ctrl.expectOne('/api/orders/sync');
    expect(req.request.headers.get('X-Last-Online')).toBe('2026-11-08T01:00:00.000Z');
    req.flush({});
  });

  it('does not add the header to other calls', () => {
    http.post('/api/orders', {}).subscribe();

    const req = ctrl.expectOne('/api/orders');
    expect(req.request.headers.has('X-Last-Online')).toBe(false);
    req.flush({});
  });

  it('checks the subscription again after a 402', () => {
    http.post('/api/orders', {}).subscribe({ error: () => undefined });
    ctrl.expectOne('/api/orders').flush({}, { status: 402, statusText: 'Payment Required' });

    expect(subscription.refresh).toHaveBeenCalled();
  });
});
