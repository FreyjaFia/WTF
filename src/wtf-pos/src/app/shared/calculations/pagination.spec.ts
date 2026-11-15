import {
  firstRowFor,
  isPageSizeOption,
  lastRowFor,
  pageItems,
  totalPagesFor,
} from './pagination';

describe('pagination', () => {
  it('counts pages and never goes below one', () => {
    expect(totalPagesFor(0, 25)).toBe(1);
    expect(totalPagesFor(25, 25)).toBe(1);
    expect(totalPagesFor(26, 25)).toBe(2);
    expect(totalPagesFor(61, 20)).toBe(4);
  });

  it('gives first and last row of a page', () => {
    expect(firstRowFor(1, 25, 0)).toBe(0);
    expect(firstRowFor(2, 25, 60)).toBe(26);
    expect(lastRowFor(3, 25, 60)).toBe(60);
    expect(lastRowFor(1, 25, 60)).toBe(25);
  });

  it('lists every page when there are seven or fewer', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('puts ellipses between distant pages', () => {
    expect(pageItems(1, 20)).toEqual([1, 2, null, 20]);
    expect(pageItems(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageItems(20, 20)).toEqual([1, null, 19, 20]);
    expect(pageItems(3, 8)).toEqual([1, 2, 3, 4, null, 8]);
  });

  it('accepts only listed page sizes', () => {
    expect(isPageSizeOption(25)).toBe(true);
    expect(isPageSizeOption(30)).toBe(false);
    expect(isPageSizeOption('25')).toBe(false);
  });
});
