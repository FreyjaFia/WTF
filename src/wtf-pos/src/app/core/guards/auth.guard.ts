import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export const authGuard: CanActivateFn = (_route, _state) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  // Check if token is valid
  if (auth.isTokenValid()) {
    return true;
  }

  // Token is expired or invalid, try to refresh
  const refreshToken = auth.getRefreshToken();

  if (refreshToken && !auth.isTokenValid()) {
    // Attempt to refresh the token
    return auth.refreshToken().pipe(
      map(() => true),
      catchError((error: unknown) => {
        // Offline or a server fault: the refresh token is still good, so let the person in and refresh later.
        if (error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500)) {
          return of(true);
        }

        // Refresh failed, redirect to login
        router.navigateByUrl(AppRoutes.Login, { replaceUrl: true });
        return of(false);
      }),
    );
  }

  // No valid token and no refresh token, redirect to login
  router.navigateByUrl(AppRoutes.Login, { replaceUrl: true });
  return false;
};
