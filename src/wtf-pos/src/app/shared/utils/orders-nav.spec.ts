import { describe, expect, it } from 'vitest';
import { ordersNavSection } from './orders-nav';

describe('ordersNavSection', () => {
  it.each([
    ['/orders/list', 'orders'],
    ['/orders/list?page=2', 'orders'],
    ['/orders/details/abc-123', 'orders'],
    ['/orders/editor/abc-123', 'new-order'],
    ['/orders/editor?offline=OFF-1', 'new-order'],
    ['/orders/editor', 'new-order'],
    ['/orders/editor?x=1', 'new-order'],
    ['/orders/editor#cart', 'new-order'],
    ['/dashboard', null],
    ['/management/customers', null],
    ['/orders', null],
  ])('%s is %s', (url, expected) => {
    expect(ordersNavSection(url)).toBe(expected);
  });
});
