import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ListStateService {
  public load<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);

      if (!raw) {
        return fallback;
      }

      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  public save<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures to avoid blocking UX.
    }
  }
}
