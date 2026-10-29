import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AlertService, NotificationService } from '@core/services';
import { NotificationDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsComponent } from './notifications';

const row = (id: string, overrides: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  kind: 'StockAlert',
  severity: 'Critical',
  title: `Out of stock: ${id}`,
  body: 'None left.',
  path: `/inventory/items/details/${id}`,
  subjectId: id,
  createdAt: new Date().toISOString(),
  isRead: false,
  reminderCount: 0,
  ...overrides,
});

describe('NotificationsComponent', () => {
  function setup(options: { items?: NotificationDto[]; total?: number; unread?: number; listError?: boolean } = {}) {
    const unread = signal(options.unread ?? 0);
    const changed = new Subject<void>();
    const items = options.items ?? [];
    const service = {
      unread,
      unreadByKind: signal<Record<string, number>>({ StockAlert: options.unread ?? 0 }),
      changed: changed.asObservable(),
      start: vi.fn(),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue(
        options.listError
          ? throwError(() => new Error('Nope'))
          : of({ items, totalCount: options.total ?? items.length }),
      ),
      markRead: vi.fn().mockReturnValue(of({ unreadCount: 0, unreadByKind: {} })),
    };
    const alerts = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NotificationService, useValue: service },
        { provide: AlertService, useValue: alerts },
      ],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => [...el.querySelectorAll('[data-testid="notification-row"]')] as HTMLButtonElement[];
    return { fixture, el, service, alerts, changed, navigate, unread, rows };
  }

  it('lists the notifications, unread ones highlighted, with severity on each row', () => {
    const { rows } = setup({ items: [row('a'), row('b', { isRead: true, severity: 'Info' })], unread: 1 });

    expect(rows()).toHaveLength(2);
    expect(rows()[0].getAttribute('data-unread')).toBe('true');
    expect(rows()[0].getAttribute('data-severity')).toBe('Critical');
    expect(rows()[1].getAttribute('data-unread')).toBe('false');
  });

  it('says how many are unread, or that you are caught up', () => {
    const { el, unread, fixture } = setup({ unread: 3 });
    expect(el.querySelector('[data-testid="notifications-summary"]')?.textContent).toContain('3 unread');

    unread.set(0);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="notifications-summary"]')?.textContent).toContain('caught up');
  });

  it('shows an empty state', () => {
    const { el } = setup({ items: [] });

    expect(el.querySelector('[data-testid="notifications-empty"]')).not.toBeNull();
  });

  it('shows a reminder pill on a reminded row', () => {
    const { rows } = setup({ items: [row('a', { reminderCount: 3 })] });

    expect(rows()[0].textContent).toContain('Reminder 3');
  });

  it('starts and stops the live service with the page, and reloads when something changes', () => {
    const { fixture, service, changed } = setup({ items: [row('a')] });
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(service.list).toHaveBeenCalledTimes(1);

    changed.next();
    expect(service.list).toHaveBeenCalledTimes(2);

    fixture.destroy();
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  it('filters by kind and by unread only, reloading from the first page', () => {
    const { el, service, fixture } = setup({ items: [row('a')], unread: 1 });
    const filters = [...el.querySelectorAll('[data-testid="kind-filter"]')] as HTMLButtonElement[];
    expect(filters.map((f) => f.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['All 1', 'Stock 1', 'Waste']);

    filters[1].click();
    fixture.detectChanges();
    expect(service.list).toHaveBeenLastCalledWith({ kind: 'StockAlert', unreadOnly: false, page: 1, pageSize: 25 });
    expect(filters[1].getAttribute('aria-pressed')).toBe('true');

    (el.querySelector('[data-testid="unread-only"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(service.list).toHaveBeenLastCalledWith({ kind: 'StockAlert', unreadOnly: true, page: 1, pageSize: 25 });

    filters[0].click();
    expect(service.list).toHaveBeenLastCalledWith({ kind: null, unreadOnly: true, page: 1, pageSize: 25 });
  });

  it('loads the next page and appends it', () => {
    const first = Array.from({ length: 25 }, (_, i) => row(`a${i}`));
    const { el, service, rows, fixture } = setup({ items: first, total: 26 });
    service.list.mockReturnValue(of({ items: [row('last')], totalCount: 26 }));

    (el.querySelector('[data-testid="load-more"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service.list).toHaveBeenLastCalledWith({ kind: null, unreadOnly: false, page: 2, pageSize: 25 });
    expect(rows()).toHaveLength(26);
    expect(el.querySelector('[data-testid="load-more"]')).toBeNull();
  });

  it('hides Load More when everything is shown', () => {
    const { el } = setup({ items: [row('a')], total: 1 });

    expect(el.querySelector('[data-testid="load-more"]')).toBeNull();
  });

  it('opening a row marks it read and goes to its screen; a read row only navigates', () => {
    const { rows, service, navigate, fixture } = setup({ items: [row('a'), row('b', { isRead: true })], unread: 1 });

    rows()[0].click();
    fixture.detectChanges();
    expect(service.markRead).toHaveBeenCalledWith({ ids: ['a'] });
    expect(navigate).toHaveBeenCalledWith('/inventory/items/details/a');

    rows()[1].click();
    expect(service.markRead).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('marks everything read, and the button is off when there is nothing unread', () => {
    const { el, service, rows, fixture } = setup({ items: [row('a')], unread: 1 });
    const button = el.querySelector('[data-testid="mark-all-read"]') as HTMLButtonElement;

    button.click();
    fixture.detectChanges();

    expect(service.markRead).toHaveBeenCalledWith({ kind: undefined });
    expect(rows()[0].getAttribute('data-unread')).toBe('false');
  });

  it('only marks the chosen kind when a filter is on', () => {
    const { el, service, fixture } = setup({ items: [row('a')], unread: 1 });
    (el.querySelectorAll('[data-testid="kind-filter"]')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    (el.querySelector('[data-testid="mark-all-read"]') as HTMLButtonElement).click();

    expect(service.markRead).toHaveBeenCalledWith({ kind: 'StockAlert' });
  });

  it('disables Mark All Read when nothing is unread', () => {
    const { el } = setup({ items: [row('a', { isRead: true })], unread: 0 });

    expect((el.querySelector('[data-testid="mark-all-read"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the error when the list cannot be loaded, and when marking fails', () => {
    const failing = setup({ listError: true });
    expect(failing.alerts.error).toHaveBeenCalledWith('Nope');
    TestBed.resetTestingModule();

    const { el, service, alerts, fixture } = setup({ items: [row('a')], unread: 1 });
    service.markRead.mockReturnValue(throwError(() => new Error('Bad')));
    (el.querySelector('[data-testid="mark-all-read"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(alerts.error).toHaveBeenCalledWith('Bad');
  });
});
