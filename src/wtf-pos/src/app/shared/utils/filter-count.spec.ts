import { describe, expect, it } from 'vitest';
import { selectedFilterCount } from './filter-count';

describe('selectedFilterCount', () => {
  it.each([
    [0, 4, 0],
    [1, 4, 1],
    [3, 4, 3],
    [4, 4, 0],
    [3, 3, 0],
    [1, 2, 1],
    [2, 2, 0],
  ])('%i of %i options selected counts %i', (selected, total, expected) => {
    expect(selectedFilterCount(selected, total)).toBe(expected);
  });
});
