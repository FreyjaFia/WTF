import { HttpErrorResponse } from '@angular/common/http';

export function extractHttpErrorMessage(error: HttpErrorResponse): string | null {
  const payload = error.error as unknown;

  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload.trim();
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const direct =
    (payload as { message?: unknown }).message ??
    (payload as { Message?: unknown }).Message ??
    (payload as { title?: unknown }).title;

  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  const validationErrors = (payload as { errors?: unknown }).errors;
  if (validationErrors && typeof validationErrors === 'object') {
    const entries = Object.values(validationErrors as Record<string, unknown>);
    for (const entry of entries) {
      if (Array.isArray(entry)) {
        const first = entry.find((value) => typeof value === 'string' && value.trim().length > 0);
        if (typeof first === 'string') {
          return first.trim();
        }
      }

      if (typeof entry === 'string' && entry.trim().length > 0) {
        return entry.trim();
      }
    }
  }

  return null;
}
