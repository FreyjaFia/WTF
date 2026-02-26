import { HttpInterceptorFn } from '@angular/common/http';

function isApiRequest(url: string): boolean {
  return url.startsWith('/api') || url.includes('/api/');
}

export const timezoneInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url) || req.headers.has('X-TimeZone')) {
    return next(req);
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const timezoneReq = req.clone({
    headers: req.headers.set('X-TimeZone', timeZone),
  });

  return next(timezoneReq);
};
