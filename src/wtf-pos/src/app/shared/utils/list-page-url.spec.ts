import { ActivatedRoute, Router } from '@angular/router';
import { readPageParam, writePageParam } from './list-page-url';

describe('list page url', () => {
  const routeWith = (page: string | null) =>
    ({ snapshot: { queryParamMap: { get: () => page } } }) as unknown as ActivatedRoute;

  it('reads a page number and falls back to one', () => {
    expect(readPageParam(routeWith('4'))).toBe(4);
    expect(readPageParam(routeWith(null))).toBe(1);
    expect(readPageParam(routeWith('abc'))).toBe(1);
    expect(readPageParam(routeWith('-2'))).toBe(1);
    expect(readPageParam(routeWith('2.5'))).toBe(1);
  });

  it('drops the page from the address on page one', () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const router = { navigate } as unknown as Router;
    writePageParam(router, routeWith(null), 3);
    expect(navigate.mock.lastCall![1].queryParams).toEqual({ page: 3 });
    writePageParam(router, routeWith(null), 1);
    expect(navigate.mock.lastCall![1].queryParams).toEqual({ page: null });
    expect(navigate.mock.lastCall![1].replaceUrl).toBe(true);
  });
});
