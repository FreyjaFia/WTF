import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { map } from 'rxjs/operators';

/**
 * Matches ISO 8601 date-time strings that have NO timezone designator.
 * e.g. "2026-02-17T10:30:00" or "2026-02-17T10:30:00.123"
 * Does NOT match strings that already end with 'Z' or '+HH:MM' / '-HH:MM'.
 */
const ISO_DATE_NO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Recursively walks through a parsed JSON response and appends 'Z' to any
 * ISO date-time string that is missing timezone info, so that the browser
 * interprets it as UTC and the Angular DatePipe converts it to the user's
 * local timezone.
 */
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

/**
 * HTTP interceptor that normalises date strings in API responses so they
 * are always interpreted as UTC, ensuring the Angular DatePipe displays
 * them in the user's local timezone.
 */
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
