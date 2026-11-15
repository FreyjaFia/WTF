import { HttpParams } from '@angular/common/http';

export type PagedQuery = Record<string, string | number | boolean | readonly string[] | null | undefined>;

export function pagedParams(query: PagedQuery): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        params = params.set(key, value.join(','));
      }
      continue;
    }

    params = params.set(key, String(value));
  }

  return params;
}
