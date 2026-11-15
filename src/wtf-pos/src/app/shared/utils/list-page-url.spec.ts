import { ActivatedRoute, Router } from '@angular/router';
import { readPageParam, writePageParam } from './list-page-url';

class UrlParserStub {
  public constructor(private readonly url: string) {}

  public tree(): { queryParams: Record<string, string> } {
    return { queryParams: Object.fromEntries(new URLSearchParams(this.url.split('?')[1] ?? '')) };
  }
}

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
    const router = { navigate, url: '/list?page=3', parseUrl: (url: string) => new UrlParserStub(url).tree() } as unknown as Router;
    writePageParam(router, routeWith(null), 3);
    expect(navigate.mock.lastCall![1].queryParams).toEqual({ page: 3 });
    writePageParam(router, routeWith(null), 1);
    expect(navigate.mock.lastCall![1].queryParams).toEqual({ page: null });
    expect(navigate.mock.lastCall![1].replaceUrl).toBe(true);
  });

  it('does nothing on page one when the address has no page', () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const router = { navigate, url: '/items/details/1?returnUrl=%2Fwaste', parseUrl: (url: string) => new UrlParserStub(url).tree() } as unknown as Router;
    writePageParam(router, routeWith(null), 1);
    expect(navigate).not.toHaveBeenCalled();
  });
});
