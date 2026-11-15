import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ListStateService } from '@core/services/list-state.service';
import { ClientPager } from './client-pager';

describe('ClientPager', () => {
  let navigate: ReturnType<typeof vi.fn>;
  let saved: Record<string, unknown>;

  function create(rows: number, page: string | null = null): { pager: ClientPager<number>; source: ReturnType<typeof signal<number[]>> } {
    const source = signal(Array.from({ length: rows }, (_, i) => i + 1));
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => page } } } },
        {
          provide: ListStateService,
          useValue: {
            load: (key: string, fallback: unknown) => saved[key] ?? fallback,
            save: (key: string, value: unknown) => (saved[key] = value),
          },
        },
      ],
    });
    const pager = TestBed.runInInjectionContext(() => new ClientPager<number>(source, 'test'));
    return { pager, source };
  }

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);
    saved = {};
  });

  it('shows the first 25 rows by default', () => {
    const { pager } = create(60);
    expect(pager.rows()).toHaveLength(25);
    expect(pager.page()).toBe(1);
    expect(pager.totalCount()).toBe(60);
  });

  it('goes to a page and writes it to the address', () => {
    const { pager } = create(60);
    pager.goTo(3);
    expect(pager.rows()).toEqual(Array.from({ length: 10 }, (_, i) => 51 + i));
    expect(navigate.mock.lastCall![1].queryParams).toEqual({ page: 3 });
  });

  it('starts on the page in the address', () => {
    const { pager } = create(60, '2');
    expect(pager.page()).toBe(2);
  });

  it('falls back to the last real page when the list shrinks', () => {
    const { pager, source } = create(60, '3');
    source.set(Array.from({ length: 30 }, (_, i) => i));
    expect(pager.page()).toBe(2);
    expect(pager.rows()).toHaveLength(5);
  });

  it('saves the rows per page, restores them and returns to page 1', () => {
    const { pager } = create(120, '3');
    pager.setPageSize(50);
    expect(pager.pageSize()).toBe(50);
    expect(saved['test:paging']).toEqual({ pageSize: 50 });
    expect(navigate.mock.lastCall![1].queryParams).toEqual({ page: null });
    TestBed.resetTestingModule();
    expect(create(120).pager.pageSize()).toBe(50);
  });

  it('returns to page 1 when the reset signal changes, but not on the first run', () => {
    const key = signal('a');
    const source = signal(Array.from({ length: 60 }, (_, i) => i));
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => '3' } } } },
        { provide: ListStateService, useValue: { load: (_k: string, f: unknown) => f, save: vi.fn() } },
      ],
    });
    const pager = TestBed.runInInjectionContext(() => new ClientPager<number>(source, 'test', key));
    TestBed.tick();
    expect(pager.page()).toBe(3);

    key.set('b');
    TestBed.tick();
    expect(pager.page()).toBe(1);
  });

  it('reset does nothing when already on page 1', () => {
    const { pager } = create(60);
    pager.reset();
    expect(navigate).not.toHaveBeenCalled();
  });
});
