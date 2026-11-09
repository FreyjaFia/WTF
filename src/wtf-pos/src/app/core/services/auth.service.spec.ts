import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@core/services/auth.service';
import { environment } from '@environments/environment.development';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AuthService refresh', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  const refreshUrl = `${environment.apiUrl}/auth/refresh`;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('refreshToken', 'original-refresh-token');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shares one refresh request between concurrent callers', () => {
    const firstResult = vi.fn();
    const secondResult = vi.fn();
    const refreshed = vi.fn();
    auth.tokenRefreshed$.subscribe(refreshed);

    auth.refreshToken().subscribe(firstResult);
    auth.refreshToken().subscribe(secondResult);

    const request = http.expectOne(refreshUrl);
    expect(request.request.body).toEqual({ refreshToken: 'original-refresh-token' });
    request.flush({ accessToken: 'new-access-token', refreshToken: 'rotated-refresh-token' });

    expect(firstResult).toHaveBeenCalledWith(true);
    expect(secondResult).toHaveBeenCalledWith(true);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(auth.getToken()).toBe('new-access-token');
    expect(auth.getRefreshToken()).toBe('rotated-refresh-token');
  });

  it('uses the rotated refresh token for the next refresh', () => {
    auth.refreshToken().subscribe();
    http.expectOne(refreshUrl).flush({
      accessToken: 'first-access-token',
      refreshToken: 'rotated-refresh-token',
    });

    auth.refreshToken().subscribe();
    const request = http.expectOne(refreshUrl);
    expect(request.request.body).toEqual({ refreshToken: 'rotated-refresh-token' });
    request.flush({ accessToken: 'second-access-token', refreshToken: 'next-refresh-token' });
    expect(auth.getToken()).toBe('second-access-token');
  });

  it('shares a rejected refresh and permits a later attempt', () => {
    const logout = vi.spyOn(auth, 'logout').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const firstError = vi.fn();
    const secondError = vi.fn();
    auth.refreshToken().subscribe({ error: firstError });
    auth.refreshToken().subscribe({ error: secondError });

    http.expectOne(refreshUrl).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(firstError).toHaveBeenCalledTimes(1);
    expect(secondError).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);

    auth.refreshToken().subscribe();
    http.expectOne(refreshUrl).flush({ accessToken: 'recovered-access-token' });
    expect(auth.getToken()).toBe('recovered-access-token');
  });
});

describe('AuthService refresh failures', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  const refreshUrl = `${environment.apiUrl}/auth/refresh`;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'old-access-token');
    localStorage.setItem('refreshToken', 'original-refresh-token');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([400, 401, 403])('signs out when the refresh token is refused with %s', (status) => {
    const failed = vi.fn();
    auth.refreshToken().subscribe({ error: failed });

    http.expectOne(refreshUrl).flush({}, { status, statusText: 'Refused' });

    expect(failed).toHaveBeenCalledTimes(1);
    expect(auth.getToken()).toBeNull();
    expect(auth.getRefreshToken()).toBeNull();
  });

  it.each([0, 500, 503])('keeps the tokens when the refresh fails with %s', (status) => {
    const failed = vi.fn();
    auth.refreshToken().subscribe({ error: failed });

    const request = http.expectOne(refreshUrl);

    if (status === 0) {
      request.error(new ProgressEvent('error'));
    } else {
      request.flush({}, { status, statusText: 'Down' });
    }

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toBeInstanceOf(HttpErrorResponse);
    expect(auth.getToken()).toBe('old-access-token');
    expect(auth.getRefreshToken()).toBe('original-refresh-token');
  });
});

describe('AuthService login errors', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  const loginUrl = `${environment.apiUrl}/auth/login`;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows the message the API sends when the shop is suspended', () => {
    const failed = vi.fn();
    auth.login('owner', 'secret').subscribe({ error: failed });

    http.expectOne(loginUrl).flush(
      { message: "This shop's account is suspended. Please contact support." },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(failed.mock.calls[0][0].message).toBe("This shop's account is suspended. Please contact support.");
  });

  it('keeps the invalid username or password message for a plain 401', () => {
    const failed = vi.fn();
    auth.login('owner', 'wrong').subscribe({ error: failed });

    http.expectOne(loginUrl).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(failed.mock.calls[0][0].message).toBe('Invalid username or password.');
  });
});
