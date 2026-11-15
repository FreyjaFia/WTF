export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export function totalPagesFor(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / Math.max(1, pageSize)));
}

export function firstRowFor(page: number, pageSize: number, totalCount: number): number {
  return totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
}

export function lastRowFor(page: number, pageSize: number, totalCount: number): number {
  return Math.min(page * pageSize, totalCount);
}

export function pageItems(current: number, total: number): (number | null)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const items: (number | null)[] = [];
  for (const p of sorted) {
    const previous = items[items.length - 1];
    if (typeof previous === 'number' && p - previous > 1) {
      items.push(null);
    }
    items.push(p);
  }

  return items;
}

export function isPageSizeOption(value: unknown, options: readonly number[] = PAGE_SIZE_OPTIONS): boolean {
  return typeof value === 'number' && options.includes(value);
}
