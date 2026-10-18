const DEFAULT_TICK_COUNT = 4;

export function chartTickCount(values: readonly number[]): number {
  if (values.length === 0) {
    return DEFAULT_TICK_COUNT;
  }

  const max = Math.max(...values, 1);

  // Whole-number data with a tiny maximum (for example 1 order in an hour) would repeat the same label.
  if (max < DEFAULT_TICK_COUNT && values.every((value) => Number.isInteger(value))) {
    return Math.max(1, Math.ceil(max));
  }

  return DEFAULT_TICK_COUNT;
}
