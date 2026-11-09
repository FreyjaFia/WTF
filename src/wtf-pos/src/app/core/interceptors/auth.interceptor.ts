import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ServiceErrorMessages } from '@core/messages';
import { AlertService, AuthService, PlatformService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { catchError, switchMap, throwError } from 'rxjs';

const SUSPENDED_RESPONSE = /suspended/i;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const alerts = inject(AlertService);
  const url = req.url || '';

  // The platform area has its own sign-in: its token goes only to /platform/ calls and a 401 there returns to its login.
  if (url.includes('/platform/')) {
    if (url.includes('/platform/auth/')) {
      return next(req);
    }

    const platform = inject(PlatformService);
    const platformToken = platform.getToken();
    const platformReq = platformToken
      ? req.clone({ setHeaders: { Authorization: `Bearer ${platformToken}` } })
      : req;

    return next(platformReq).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401) {
          platform.logout();
          router.navigateByUrl(AppRoutes.PlatformLogin, { replaceUrl: true });
        }

        return throwError(() => error);
      }),
    );
  }
  const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh');

  // Public ordering pages are for customers who are not signed in. Never send a staff token to them (a staff member
  // opening a customer's link in their own browser would otherwise act as that customer) and never start a refresh
  // or login redirect when one of these calls fails.
  const isPublicEndpoint = url.includes('/public/');

  // Do not attach token or trigger refresh flow on auth endpoints.
  if (isAuthEndpoint || isPublicEndpoint) {
    return next(req);
  }

  const token = auth.getToken();

  // Attach token if available
  let authReq = req;

  if (token && !req.headers.has('Authorization')) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // If we get a 401 Unauthorized error and haven't already tried refreshing
      if (error.status === 401 && !req.headers.has('X-Refresh-Attempted')) {
        // Try to refresh the token
        return auth.refreshToken().pipe(
          catchError((refreshError: unknown) => {
            // Only a refused refresh ends the session; a failure of the retried request is passed on untouched below.
            if (refreshError instanceof HttpErrorResponse) {
              return throwError(() => refreshError);
            }

            auth.logout();
            router.navigateByUrl(AppRoutes.Login, { replaceUrl: true });
            return throwError(() => new Error(ServiceErrorMessages.Auth.SessionExpired));
          }),
          switchMap(() => {
            const newToken = auth.getToken();

            if (newToken) {
              const retryReq = req.clone({
                setHeaders: {
                  Authorization: `Bearer ${newToken}`,
                  'X-Refresh-Attempted': 'true',
                },
              });

              return next(retryReq);
            }

            return throwError(() => error);
          }),
        );
      }

      if (error.status === 403 && SUSPENDED_RESPONSE.test(error.error?.message ?? '') && auth.getToken()) {
        // The shop was suspended while this person was signed in: end the session and say why, instead of showing empty pages.
        auth.logout();
        alerts.error(error.error.message || ServiceErrorMessages.Auth.ShopSuspended);
        router.navigateByUrl(AppRoutes.Login, { replaceUrl: true });
      }

      return throwError(() => error);
    }),
  );
};
