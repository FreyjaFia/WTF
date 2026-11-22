import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BranchService } from '@core/services/branch.service';
import { catchError, switchMap } from 'rxjs/operators';
import { throwError } from 'rxjs';

const HEADER = 'X-Branch-Id';
const NOT_ALLOWED_MESSAGE = 'You cannot use that branch.';
const PICK_BRANCH_MESSAGE = 'Pick a branch first.';
const ALL_BRANCHES_VALUE = 'all';

function isApiRequest(url: string): boolean {
  return url.startsWith('/api') || url.includes('/api/');
}

function isRead(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function isAuthRequest(url: string): boolean {
  return /\/api\/auth(\/|\?|$)/.test(url);
}

function isHealthRequest(url: string): boolean {
  return /\/api\/health(\?|$)/.test(url);
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
  if (!isApiRequest(req.url) || req.headers.has(HEADER) || isBranchListRequest(req.url) || isHealthRequest(req.url)) {
    return next(req);
  }

  const branches = inject(BranchService);
  const active = branches.activeId();
  if (!active) {
    return next(req);
  }

  // Under All branches nothing is written: the API refuses it too, so say so here instead of sending it.
  if (active === ALL_BRANCHES_VALUE && !isRead(req.method) && !isAuthRequest(req.url)) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 400,
          statusText: 'Bad Request',
          url: req.url,
          error: { message: PICK_BRANCH_MESSAGE },
        }),
    );
  }

  return next(req.clone({ headers: req.headers.set(HEADER, active) })).pipe(
    catchError((error: unknown) => {
      // Only a read is sent again on its own: a write that may have gone through must never be repeated by the app.
      if (!isBranchNotAllowed(error)) {
        return throwError(() => error);
      }

      if (!isRead(req.method)) {
        // The person tries again once the branch list is repaired.
        branches.loadMine();
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
