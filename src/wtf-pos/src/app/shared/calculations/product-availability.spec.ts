import { isBranchOnly, isSoldAt, mayBranchEdit } from './product-availability';

describe('product availability', () => {
  it('a product with no branches is sold everywhere', () => {
    expect(isSoldAt(null, 'a')).toBe(true);
    expect(isSoldAt(undefined, 'a')).toBe(true);
    expect(isSoldAt([], 'a')).toBe(true);
  });

  it('a limited product is sold only at its branches', () => {
    expect(isSoldAt(['a'], 'a')).toBe(true);
    expect(isSoldAt(['a'], 'b')).toBe(false);
  });

  it('a branch-only product is exactly one branch', () => {
    expect(isBranchOnly(['a'])).toBe(true);
    expect(isBranchOnly(['a', 'b'])).toBe(false);
    expect(isBranchOnly(null)).toBe(false);
  });

  it('a branch manager edits only products limited to their own branches', () => {
    expect(mayBranchEdit(null, ['a'])).toBe(false);
    expect(mayBranchEdit([], ['a'])).toBe(false);
    expect(mayBranchEdit(['a'], ['a'])).toBe(true);
    expect(mayBranchEdit(['a', 'b'], ['a'])).toBe(false);
    expect(mayBranchEdit(['a', 'b'], ['a', 'b', 'c'])).toBe(true);
  });
});
