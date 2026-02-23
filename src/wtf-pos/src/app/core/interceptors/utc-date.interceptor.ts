import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { map } from 'rxjs/operators';

const ISO_DATE_NO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

function normalizeDates(value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_NO_TZ.test(value)) {
    return value + 'Z';
  }

  if (Array.isArray(value)) {
    return value.map(normalizeDates);
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(value)) {
      result[key] = normalizeDates((value as Record<string, unknown>)[key]);
    }

    return result;
  }

  return value;
}

export const utcDateInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    map((event) => {
      if (event instanceof HttpResponse && event.body) {
        return event.clone({ body: normalizeDates(event.body) });
      }

      return event;
    }),
  );
};
