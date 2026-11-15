import { Injectable } from '@angular/core';

export interface ListScrollPosition {
  pages: number;
  offset: number;
}

@Injectable({ providedIn: 'root' })
export class ListScrollService {
  private readonly prefix = 'list-scroll:';

  public save(key: string, position: ListScrollPosition): void {
    try {
      sessionStorage.setItem(this.prefix + key, JSON.stringify(position));
    } catch {
      // Private mode or full storage: the list simply opens at the top.
    }
  }

  public take(key: string): ListScrollPosition | null {
    try {
      const raw = sessionStorage.getItem(this.prefix + key);
      sessionStorage.removeItem(this.prefix + key);
      if (!raw) {
        return null;
      }

      const value = JSON.parse(raw) as Partial<ListScrollPosition>;
      return typeof value.pages === 'number' && typeof value.offset === 'number'
        ? { pages: value.pages, offset: value.offset }
        : null;
    } catch {
      return null;
    }
  }

  public clear(key: string): void {
    try {
      sessionStorage.removeItem(this.prefix + key);
    } catch {
      // Nothing to clear.
    }
  }
}
