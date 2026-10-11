import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ServiceErrorMessages } from '@core/messages';
import { AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
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
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let ctrl: HttpTestingController;
  let http: HttpClient;

  beforeEach(() => {
    auth = { getToken: vi.fn().mockReturnValue('tok'), refreshToken: vi.fn(), logout: vi.fn() };
    router = { navigateByUrl: vi.fn() };
    ({ http, ctrl } = setup([authInterceptor], [
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
    ]));
  });

  afterEach(() => ctrl.verify());

  it('attaches the bearer token', () => {
    http.get('/api/orders').subscribe();

    const req = ctrl.expectOne('/api/orders');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    req.flush({});
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

    // Inner error is swallowed by the refresh-failure handler, which logs out.
    expect(auth.logout).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
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
