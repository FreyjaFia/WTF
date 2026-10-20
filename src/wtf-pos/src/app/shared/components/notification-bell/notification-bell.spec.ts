import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NotificationService } from '@core/services';
import { NotificationDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBellComponent } from './notification-bell';

const row = (id: string, overrides: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  kind: 'StockAlert',
  severity: 'Warning',
  title: `Low stock: ${id}`,
  body: '400 ml left.',
  path: `/inventory/items/details/${id}`,
  subjectId: id,
  createdAt: new Date().toISOString(),
  isRead: false,
  reminderCount: 0,
  ...overrides,
});

describe('NotificationBellComponent', () => {
  function setup(options: { unread?: number; items?: NotificationDto[]; listError?: boolean } = {}) {
    const unread = signal(options.unread ?? 0);
    const changed = new Subject<void>();
    const service = {
      unread,
      unreadByKind: signal({}),
      changed: changed.asObservable(),
      start: vi.fn(),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue(
        options.listError ? throwError(() => new Error('x')) : of({ items: options.items ?? [], totalCount: 0 }),
      ),
      markRead: vi.fn().mockReturnValue(of({ unreadCount: 0, unreadByKind: {} })),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: NotificationService, useValue: service }],
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const open = () => {
      (el.querySelector('[data-bell]') as HTMLButtonElement).click();
      fixture.detectChanges();
    };
    return { fixture, el, service, unread, changed, navigate, open };
  }

  it('shows a red number only while something is unread, capped at 99+', () => {
    const { fixture, el, unread } = setup();
    expect(el.querySelector('[data-bell-badge]')).toBeNull();

    unread.set(4);
    fixture.detectChanges();
    expect(el.querySelector('[data-bell-badge]')?.textContent?.trim()).toBe('4');

    unread.set(250);
    fixture.detectChanges();
    expect(el.querySelector('[data-bell-badge]')?.textContent?.trim()).toBe('99+');
  });

  it('says how many are unread to screen readers', () => {
    const { fixture, el, unread } = setup({ unread: 3 });
    expect(el.querySelector('[data-bell]')?.getAttribute('aria-label')).toBe('Notifications, 3 unread');

    unread.set(0);
    fixture.detectChanges();
    expect(el.querySelector('[data-bell]')?.getAttribute('aria-label')).toBe('Notifications');
  });

  it('starts listening with the bell and stops when it goes away', () => {
    const { fixture, service } = setup();
    expect(service.start).toHaveBeenCalledTimes(1);

    fixture.destroy();

    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  it('opens the latest ten when pressed, and closes on a second press', () => {
    const { el, service, open, fixture } = setup({ items: [row('a'), row('b')] });
    expect(el.querySelector('[data-bell-panel]')).toBeNull();

    open();

    expect(service.list).toHaveBeenCalledWith({ pageSize: 10 });
    expect(el.querySelectorAll('[data-bell-item]')).toHaveLength(2);

    (el.querySelector('[data-bell]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-bell-panel]')).toBeNull();
  });

  it('says so when there is nothing', () => {
    const { el, open } = setup({ items: [] });

    open();

    expect(el.querySelector('[data-bell-empty]')).not.toBeNull();
  });

  it('highlights unread rows and shows a reminder count', () => {
    const { el, open } = setup({ items: [row('a'), row('b', { isRead: true, reminderCount: 2 })] });

    open();

    const items = el.querySelectorAll('[data-bell-item]');
    expect(items[0].getAttribute('data-unread')).toBe('true');
    expect(items[1].getAttribute('data-unread')).toBe('false');
    expect(items[1].textContent).toContain('Reminder 2');
  });

  it('opening a row marks it read and goes to its screen', () => {
    const { el, service, navigate, open, fixture } = setup({ items: [row('a')] });
    open();

    (el.querySelector('[data-bell-item]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service.markRead).toHaveBeenCalledWith({ ids: ['a'] });
    expect(navigate).toHaveBeenCalledWith('/inventory/items/details/a');
    expect(el.querySelector('[data-bell-panel]')).toBeNull();
  });

  it('opening a read row only goes to its screen', () => {
    const { el, service, navigate, open } = setup({ items: [row('a', { isRead: true })] });
    open();

    (el.querySelector('[data-bell-item]') as HTMLButtonElement).click();

    expect(service.markRead).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('opening a row with no path just marks it read', () => {
    const { el, service, navigate, open } = setup({ items: [row('a', { path: null })] });
    open();

    (el.querySelector('[data-bell-item]') as HTMLButtonElement).click();

    expect(service.markRead).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('marks everything read from the panel, and the button is off when nothing is unread', () => {
    const { el, service, open, fixture } = setup({ unread: 2, items: [row('a'), row('b')] });
    open();
    const button = el.querySelector('[data-bell-mark-all]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    button.click();
    fixture.detectChanges();

    expect(service.markRead).toHaveBeenCalledWith();
    expect([...el.querySelectorAll('[data-bell-item]')].every((i) => i.getAttribute('data-unread') === 'false')).toBe(true);
  });

  it('disables Mark all read when nothing is unread', () => {
    const { el, open } = setup({ unread: 0, items: [row('a', { isRead: true })] });
    open();

    expect((el.querySelector('[data-bell-mark-all]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers See all, which closes the panel', () => {
    const { el, open, fixture } = setup({ items: [row('a')] });
    open();
    const link = el.querySelector('[data-bell-see-all]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/notifications');

    link.click();
    fixture.detectChanges();

    expect(el.querySelector('[data-bell-panel]')).toBeNull();
  });

  it('reloads an open panel when a live change arrives, and ignores it while closed', () => {
    const { service, changed, open } = setup({ items: [row('a')] });
    changed.next();
    expect(service.list).not.toHaveBeenCalled();

    open();
    expect(service.list).toHaveBeenCalledTimes(1);
    changed.next();

    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape and on a click outside', () => {
    const { el, open, fixture } = setup({ items: [row('a')] });
    open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('[data-bell-panel]')).toBeNull();

    open();
    document.body.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-bell-panel]')).toBeNull();
  });

  it('stays quiet when the list cannot be loaded', () => {
    const { el, open } = setup({ listError: true });

    open();

    expect(el.querySelector('[data-bell-empty]')).not.toBeNull();
  });
});
