import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BranchService } from '@core/services/branch.service';

function isApiRequest(url: string): boolean {
  return url.startsWith('/api') || url.includes('/api/');
}

export const branchInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url) || req.headers.has('X-Branch-Id')) {
    return next(req);
  }

  const active = inject(BranchService).activeId();
  if (!active) {
    return next(req);
  }

  return next(req.clone({ headers: req.headers.set('X-Branch-Id', active) }));
};
