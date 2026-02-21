import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@core/services';
import { catchError, switchMap, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const url = req.url || '';
  const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh');

  // Do not attach token or trigger refresh flow on auth endpoints.
  if (isAuthEndpoint) {
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
          switchMap(() => {
            // Get the new token
            const newToken = auth.getToken();

            if (newToken) {
              // Retry the original request with the new token
              const retryReq = req.clone({
                setHeaders: {
                  Authorization: `Bearer ${newToken}`,
                  'X-Refresh-Attempted': 'true',
                },
              });

              return next(retryReq);
            }

            // If we couldn't get a new token, reject
            return throwError(() => error);
          }),
          catchError(() => {
            // If refresh fails, logout and navigate to login
            auth.logout();
            router.navigateByUrl('/login');
            return throwError(() => error);
          }),
        );
      }

      return throwError(() => error);
    }),
  );
};
