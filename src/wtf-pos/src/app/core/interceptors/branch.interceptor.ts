import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BranchService } from '@core/services/branch.service';
import { catchError, switchMap } from 'rxjs/operators';
import { throwError } from 'rxjs';

const HEADER = 'X-Branch-Id';
const NOT_ALLOWED_MESSAGE = 'You cannot use that branch.';

function isApiRequest(url: string): boolean {
  return url.startsWith('/api') || url.includes('/api/');
}

function isBranchListRequest(url: string): boolean {
  return /\/api\/branches\/mine(\?|$)/.test(url);
}

function isBranchNotAllowed(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 403 &&
    (error.error as { message?: string } | null)?.message === NOT_ALLOWED_MESSAGE
  );
}

export const branchInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url) || req.headers.has(HEADER) || isBranchListRequest(req.url)) {
    return next(req);
  }

  const branches = inject(BranchService);
  const active = branches.activeId();
  if (!active) {
    return next(req);
  }

  return next(req.clone({ headers: req.headers.set(HEADER, active) })).pipe(
    catchError((error: unknown) => {
      if (!isBranchNotAllowed(error)) {
        return throwError(() => error);
      }

      // The saved branch no longer exists or is not allowed (for example after a data reset), so repair it and retry once.
      return branches.recover().pipe(
        switchMap((fixed) => {
          if (!fixed || fixed === active) {
            return throwError(() => error);
          }

          return next(req.clone({ headers: req.headers.set(HEADER, fixed) }));
        }),
        catchError(() => throwError(() => error)),
      );
    }),
  );
};
