import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicOrderDto } from '@shared/models';
import { describe, expect, it, vi } from 'vitest';
import { publicStatusVariant } from '../public-order-status';
import { PublicOrdersComponent, PublicOrdersState } from './public-orders';

const make = (id: string, createdAt: string, over: Partial<PublicOrderDto> = {}): PublicOrderDto => ({
  id,
  orderNumber: 1001,
  createdAt,
  statusLabel: 'Waiting for confirmation',
  statusKind: 'waiting',
  items: [
    { name: 'Latte', quantity: 2, unitPrice: 150, addOns: [], specialInstructions: null },
    { name: 'Croissant', quantity: 1, unitPrice: 90, addOns: [], specialInstructions: null },
  ],
  total: 390,
  ...over,
});

describe('PublicOrdersComponent', () => {
  let fixture: ComponentFixture<PublicOrdersComponent>;

  function setup(
    orders: PublicOrderDto[],
    opts: { state?: PublicOrdersState; error?: string } = {},
  ) {
    fixture = TestBed.createComponent(PublicOrdersComponent);
    fixture.componentRef.setInput('orders', orders);
    fixture.componentRef.setInput('state', opts.state ?? 'ready');
    fixture.componentRef.setInput('errorMessage', opts.error ?? '');
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const rows = () => [...el().querySelectorAll('[data-order-row]')] as HTMLElement[];

  it('shows one row per order with its number, status, item count and total', () => {
    setup([make('a', '2026-01-11T09:00:00', { orderNumber: 1002 })]);
    expect(rows().length).toBe(1);
    expect(text()).toContain('#1002');
    expect(text()).toContain('Waiting for confirmation');
    expect(text()).toContain('3 items');
    expect(text()).toContain('390.00');
  });

  it('says "1 item" for a single item', () => {
    setup([
      make('a', '2026-01-11T09:00:00', {
        items: [{ name: 'Latte', quantity: 1, unitPrice: 150, addOns: [], specialInstructions: null }],
      }),
    ]);
    expect(text()).toContain('1 item');
    expect(text()).not.toContain('1 items');
  });

  it('groups the orders under a heading for each day', () => {
    setup([
      make('a', '2026-01-11T09:00:00'),
      make('b', '2026-01-11T08:00:00'),
      make('c', '2026-01-10T09:00:00'),
    ]);
    expect(text()).toContain('Sunday, Jan 11');
    expect(text()).toContain('Saturday, Jan 10');
    expect(rows().length).toBe(3);
  });

  it('labels the last two days Today and Yesterday, like the shop order list', () => {
    const day = (back: number) => {
      const d = new Date();
      d.setDate(d.getDate() - back);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    };
    setup([make('a', day(0)), make('b', day(1)), make('c', day(5))]);
    const labels = [...el().querySelectorAll('.uppercase.tracking-wide')].map((e) =>
      e.textContent!.trim(),
    );
    expect(labels[0]).toBe('Today');
    expect(labels[1]).toBe('Yesterday');
    expect(labels[2]).toMatch(/^[A-Za-z]+day, [A-Za-z]{3} [0-9]{1,2}$/);
  });

  it('shows the rejected status but not the reason, which can be long (it is on the details)', () => {
    setup([
      make('a', '2026-01-11T09:00:00', {
        statusKind: 'rejected',
        statusLabel: 'Rejected',
        rejectionReason: 'Closed today',
      }),
    ]);
    expect(text()).toContain('Rejected');
    expect(text()).not.toContain('Closed today');
  });

  describe('opening an order', () => {
    it('by click, Enter or Space', () => {
      setup([make('a', '2026-01-11T09:00:00')]);
      const opened = vi.fn();
      fixture.componentInstance.opened.subscribe(opened);

      rows()[0].click();
      rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

      expect(opened).toHaveBeenCalledTimes(3);
      expect(opened).toHaveBeenCalledWith('a');
    });

    it('makes each row reachable by keyboard', () => {
      setup([make('a', '2026-01-11T09:00:00')]);
      expect(rows()[0].getAttribute('role')).toBe('button');
      expect(rows()[0].tabIndex).toBe(0);
    });
  });

  describe('states', () => {
    it('shows a spinner while the first load runs', () => {
      setup([], { state: 'loading' });
      expect(el().querySelector('.loading-spinner')).not.toBeNull();
    });

    it('keeps the list on screen while it refreshes', () => {
      setup([make('a', '2026-01-11T09:00:00')], { state: 'loading' });
      expect(rows().length).toBe(1);
    });

    it('says so when there are no orders yet', () => {
      setup([]);
      expect(text()).toContain('You have not placed any orders yet.');
    });

    it('replaces the list with an offline notice but keeps the title and search', () => {
      fixture = TestBed.createComponent(PublicOrdersComponent);
      fixture.componentRef.setInput('orders', [make('a', '2026-01-11T09:00:00')]);
      fixture.componentRef.setInput('offline', true);
      fixture.detectChanges();

      expect(el().querySelector('[data-offline-notice]')).not.toBeNull();
      expect(rows().length).toBe(0);
      expect(text()).toContain('My orders');
      expect(el().querySelector('app-search-input')).not.toBeNull();
    });

    it('shows the error', () => {
      setup([], { state: 'error', error: 'Failed to load your orders.' });
      expect(text()).toContain('Failed to load your orders.');
    });
  });

  describe('filters', () => {
    const day = (back: number) => {
      const d = new Date();
      d.setDate(d.getDate() - back);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    };
    const mixed = () => [
      make('w', day(0), { statusKind: 'waiting', orderNumber: 1 }),
      make('r', day(2), { statusKind: 'ready', statusLabel: 'Ready for pickup', orderNumber: 2 }),
      make('c', day(20), { statusKind: 'completed', statusLabel: 'Completed', orderNumber: 3 }),
    ];
    const numbers = () => rows().map((row) => row.textContent!.match(/#(\d+)/)![1]);
    const c = () => fixture.componentInstance as unknown as {
      toggleStatus: (k: string) => void;
      dateRange: { set: (v: string) => void };
      isFiltersOpen: () => boolean;
      filterCount: () => number;
      clearFilters: () => void;
    };

    it('has a Filters button that opens the drawer', () => {
      setup(mixed());
      const button = el().querySelector('[data-filters-button]') as HTMLElement;
      expect(button.textContent).toContain('Filters');
      button.click();
      expect(c().isFiltersOpen()).toBe(true);
    });

    it('shows everything until a filter is chosen', () => {
      setup(mixed());
      expect(rows().length).toBe(3);
      expect(c().filterCount()).toBe(0);
    });

    it('filters by status, several at once, and counts them on the button', () => {
      setup(mixed());
      c().toggleStatus('waiting');
      c().toggleStatus('ready');
      fixture.detectChanges();
      expect(numbers().sort()).toEqual(['1', '2']);
      expect(c().filterCount()).toBe(2);
      expect(el().querySelector('[data-filters-button]')!.textContent).toContain('2');

      c().toggleStatus('waiting');
      fixture.detectChanges();
      expect(numbers()).toEqual(['2']);
    });

    it('filters by date range', () => {
      setup(mixed());
      c().dateRange.set('today');
      fixture.detectChanges();
      expect(numbers()).toEqual(['1']);

      c().dateRange.set('7d');
      fixture.detectChanges();
      expect(numbers().sort()).toEqual(['1', '2']);

      c().dateRange.set('30d');
      fixture.detectChanges();
      expect(rows().length).toBe(3);
    });

    it('combines status and date, and says so when nothing matches, with a way to clear', () => {
      setup(mixed());
      c().toggleStatus('completed');
      c().dateRange.set('7d');
      fixture.detectChanges();
      expect(rows().length).toBe(0);
      expect(text()).toContain('No orders match your search or filters.');

      c().clearFilters();
      fixture.detectChanges();
      expect(rows().length).toBe(3);
    });

    it('lists every status with how many orders have it', () => {
      setup(mixed());
      const options = (fixture.componentInstance as unknown as {
        statusOptions: () => { kind: string; count: number }[];
      }).statusOptions();
      expect(options.find((o) => o.kind === 'waiting')!.count).toBe(1);
      expect(options.find((o) => o.kind === 'rejected')!.count).toBe(0);
      expect(options.map((o) => o.kind)).toContain('ready');
    });
  });

  const day = () => new Date().toISOString();
  const some = () => [
    make('a', day(), { orderNumber: 1042 }),
    make('b', day(), { orderNumber: 1043 }),
    make('c', day(), { orderNumber: 2007 }),
  ];

  describe('search by order number', () => {
    const numbers = () => rows().map((row) => row.textContent!.match(/#(\d+)/)![1]);
    const search = (value: string) =>
      (fixture.componentInstance as unknown as { search: { set: (v: string) => void } }).search.set(value);

    it('has a search box like the shop order list', () => {
      setup(some());
      const input = el().querySelector('app-search-input input') as HTMLInputElement;
      expect(input.placeholder).toBe('Search by order #');
    });

    it('shows everything until something is typed', () => {
      setup(some());
      expect(rows().length).toBe(3);
    });

    it('finds orders whose number contains what was typed', () => {
      setup(some());
      search('104');
      fixture.detectChanges();
      expect(numbers().sort()).toEqual(['1042', '1043']);

      search('2007');
      fixture.detectChanges();
      expect(numbers()).toEqual(['2007']);
    });

    it('ignores a leading # and spaces', () => {
      setup(some());
      search('  #1043 ');
      fixture.detectChanges();
      expect(numbers()).toEqual(['1043']);
    });

    it('works together with the filters', () => {
      setup([
        make('a', day(), { orderNumber: 1042, statusKind: 'ready' }),
        make('b', day(), { orderNumber: 1043, statusKind: 'waiting' }),
      ]);
      search('104');
      (fixture.componentInstance as unknown as { toggleStatus: (k: string) => void }).toggleStatus('ready');
      fixture.detectChanges();
      expect(numbers()).toEqual(['1042']);
    });

    it('says so when nothing matches, and clearing brings everything back', () => {
      setup(some());
      search('9999');
      fixture.detectChanges();
      expect(rows().length).toBe(0);
      expect(text()).toContain('No orders match your search or filters.');

      const clear = [...el().querySelectorAll('button')].find((b) =>
        b.textContent!.includes('Clear search and filters'),
      )!;
      clear.click();
      fixture.detectChanges();
      expect(rows().length).toBe(3);
    });

    it('does not count as a filter on the button', () => {
      setup(some());
      search('104');
      expect((fixture.componentInstance as unknown as { filterCount: () => number }).filterCount()).toBe(0);
    });
  });

  describe('sorting', () => {
    const when = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600e3).toISOString();
    const mixed = () => [
      make('a', when(1), { orderNumber: 1002, total: 500 }),
      make('b', when(3), { orderNumber: 1003, total: 100 }),
      make('c', when(2), { orderNumber: 1001, total: 300 }),
    ];
    const numbers = () => rows().map((row) => row.textContent!.match(/#(\d+)/)![1]);
    const titles = () => [...el().querySelectorAll('[data-sort]')] as HTMLElement[];
    const title = (column: string) => el().querySelector(`[data-sort="${column}"]`) as HTMLElement;
    const c = () => fixture.componentInstance as unknown as {
      sortColumn: () => string;
      sortDirection: () => string;
      toggleSort: (column: string) => void;
    };

    it('has sortable Order, Date and Total headings, and plain Status and Items', () => {
      setup(mixed());
      expect(titles().map((t) => t.getAttribute('data-sort'))).toEqual(['orderNumber', 'date', 'total']);
      const heading = el().querySelector('[data-column-titles]')!.textContent!;
      expect(heading).toContain('Status');
      expect(heading).toContain('Items');
      for (const t of titles()) {
        expect(t.getAttribute('role')).toBe('button');
        expect(t.tabIndex).toBe(0);
      }
    });

    it('starts with the newest first, with the Date heading marked', () => {
      setup(mixed());
      expect(numbers()).toEqual(['1002', '1001', '1003']);
      expect(c().sortColumn()).toBe('date');
      expect(c().sortDirection()).toBe('desc');
      expect(title('date').className).toContain('text-[#047857]');
      expect(title('total').className).not.toContain('text-[#047857]');
    });

    it('sorts by order number, biggest first, then the other way on a second press', () => {
      setup(mixed());
      title('orderNumber').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1003', '1002', '1001']);

      title('orderNumber').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1001', '1002', '1003']);
      expect(c().sortDirection()).toBe('asc');
    });

    it('sorts by total', () => {
      setup(mixed());
      title('total').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1002', '1001', '1003']);

      title('total').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1003', '1001', '1002']);
    });

    it('sorts by date, oldest first on the second press', () => {
      setup(mixed());
      title('date').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1003', '1001', '1002']);
    });

    it('can be pressed from the keyboard', () => {
      setup(mixed());
      title('orderNumber').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      expect(c().sortColumn()).toBe('orderNumber');
      title('total').dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      expect(c().sortColumn()).toBe('total');
    });

    it('keeps the filters and the search while sorting', () => {
      setup([
        make('a', when(1), { orderNumber: 1002, total: 500, statusKind: 'ready' }),
        make('b', when(3), { orderNumber: 1003, total: 100, statusKind: 'ready' }),
        make('c', when(2), { orderNumber: 1001, total: 300, statusKind: 'waiting' }),
      ]);
      (fixture.componentInstance as unknown as { toggleStatus: (k: string) => void }).toggleStatus('ready');
      title('total').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1002', '1003']);
    });

    it('keeps the headings in view while the list scrolls', () => {
      setup(mixed());
      expect(el().querySelector('[data-column-titles]')!.className).toContain('sticky');
    });
  });

  describe('sorting', () => {
    const when = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600e3).toISOString();
    const mixed = () => [
      make('a', when(1), { orderNumber: 1002, total: 500 }),
      make('b', when(3), { orderNumber: 1003, total: 100 }),
      make('c', when(2), { orderNumber: 1001, total: 300 }),
    ];
    const numbers = () => rows().map((row) => row.textContent!.match(/#(\d+)/)![1]);
    const titles = () => [...el().querySelectorAll('[data-sort]')] as HTMLElement[];
    const title = (column: string) => el().querySelector(`[data-sort="${column}"]`) as HTMLElement;
    const c = () => fixture.componentInstance as unknown as {
      sortColumn: () => string;
      sortDirection: () => string;
      toggleSort: (column: string) => void;
    };

    it('has sortable Order, Date and Total headings, and plain Status and Items', () => {
      setup(mixed());
      expect(titles().map((t) => t.getAttribute('data-sort'))).toEqual(['orderNumber', 'date', 'total']);
      const heading = el().querySelector('[data-column-titles]')!.textContent!;
      expect(heading).toContain('Status');
      expect(heading).toContain('Items');
      for (const t of titles()) {
        expect(t.getAttribute('role')).toBe('button');
        expect(t.tabIndex).toBe(0);
      }
    });

    it('starts with the newest first, with the Date heading marked', () => {
      setup(mixed());
      expect(numbers()).toEqual(['1002', '1001', '1003']);
      expect(c().sortColumn()).toBe('date');
      expect(c().sortDirection()).toBe('desc');
      expect(title('date').className).toContain('text-[#047857]');
      expect(title('total').className).not.toContain('text-[#047857]');
    });

    it('sorts by order number, biggest first, then the other way on a second press', () => {
      setup(mixed());
      title('orderNumber').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1003', '1002', '1001']);

      title('orderNumber').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1001', '1002', '1003']);
      expect(c().sortDirection()).toBe('asc');
    });

    it('sorts by total', () => {
      setup(mixed());
      title('total').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1002', '1001', '1003']);

      title('total').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1003', '1001', '1002']);
    });

    it('sorts by date, oldest first on the second press', () => {
      setup(mixed());
      title('date').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1003', '1001', '1002']);
    });

    it('can be pressed from the keyboard', () => {
      setup(mixed());
      title('orderNumber').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      expect(c().sortColumn()).toBe('orderNumber');
      title('total').dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      expect(c().sortColumn()).toBe('total');
    });

    it('keeps the filters and the search while sorting', () => {
      setup([
        make('a', when(1), { orderNumber: 1002, total: 500, statusKind: 'ready' }),
        make('b', when(3), { orderNumber: 1003, total: 100, statusKind: 'ready' }),
        make('c', when(2), { orderNumber: 1001, total: 300, statusKind: 'waiting' }),
      ]);
      (fixture.componentInstance as unknown as { toggleStatus: (k: string) => void }).toggleStatus('ready');
      title('total').click();
      fixture.detectChanges();
      expect(numbers()).toEqual(['1002', '1003']);
    });

    it('keeps the headings in view while the list scrolls', () => {
      setup(mixed());
      expect(el().querySelector('[data-column-titles]')!.className).toContain('sticky');
    });
  });

  describe('layout', () => {
    it('scrolls only the list, so the title and the search stay in place', () => {
      setup(some());
      const host = el();
      expect(fixture.nativeElement.className).toContain('flex-col');
      const scroller = host.querySelector('.overflow-y-auto') as HTMLElement;
      expect(scroller).not.toBeNull();
      expect(scroller.querySelectorAll('[data-order-row]').length).toBe(3);
      expect(scroller.querySelector('h1')).toBeNull();
      expect(scroller.querySelector('app-search-input')).toBeNull();
    });
  });

  describe('header', () => {
    it('has a short line under the title', () => {
      setup([]);
      expect(text()).toContain('Track the orders you have placed.');
    });

    it('has a New Order button that asks the page to show the menu', () => {
      setup([]);
      const asked = vi.fn();
      fixture.componentInstance.newOrder.subscribe(asked);
      const button = el().querySelector('[data-new-order]') as HTMLElement;
      expect(button.textContent).toContain('New Order');
      expect(button.className).toContain('app-btn-primary');
      button.click();
      expect(asked).toHaveBeenCalledTimes(1);
    });

    it('counts no filter when every status is chosen', () => {
      setup([]);
      const c = fixture.componentInstance as unknown as {
        toggleStatus: (k: string) => void;
        filterCount: () => number;
      };
      for (const kind of ['waiting', 'accepted', 'ready', 'completed', 'rejected', 'cancelled', 'refunded']) {
        c.toggleStatus(kind);
      }
      expect(c.filterCount()).toBe(0);
    });
  });

  describe('refresh', () => {
    it('asks the page to reload', () => {
      setup([]);
      const refresh = vi.fn();
      fixture.componentInstance.refresh.subscribe(refresh);
      (el().querySelector('[aria-label="Refresh orders"]') as HTMLElement).click();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('is off and spinning while it loads', () => {
      setup([], { state: 'loading' });
      const button = el().querySelector('[aria-label="Refresh orders"]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.innerHTML).toContain('animate-spin');
    });
  });
});

describe('publicStatusVariant', () => {
  it('colors the status badge by kind', () => {
    expect(publicStatusVariant('waiting')).toBe('amber');
    expect(publicStatusVariant('accepted')).toBe('info');
    expect(publicStatusVariant('completed')).toBe('success');
    expect(publicStatusVariant('rejected')).toBe('error');
    expect(publicStatusVariant('cancelled')).toBe('default');
    expect(publicStatusVariant('refunded')).toBe('default');
  });
});
