import { provideHttpClient } from '@angular/common/http';
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
