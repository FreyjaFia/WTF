import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AlertService, StockAlertService } from '@core/services';
import { StockNotificationDto, StockNotificationListDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StockAlertsComponent } from './stock-alerts';

const note = (id: string, over: Partial<StockNotificationDto> = {}): StockNotificationDto => ({
  id,
  itemId: `item-${id}`,
  itemName: 'Oat Milk',
  status: 'Warning',
  quantity: 400,
  title: `Low stock: Oat Milk ${id}`,
  body: '400 ml left. The warning level is 500 ml.',
  createdAt: '2026-10-21T08:00:00Z',
  isRead: false,
  ...over,
});

const listOf = (items: StockNotificationDto[], totalCount = items.length): StockNotificationListDto => ({
  items,
  totalCount,
  unreadCount: items.filter((n) => !n.isRead).length,
});

interface Vm {
  markAllRead: () => void;
  open: (n: StockNotificationDto) => void;
  load: (reset: boolean) => void;
}

describe('StockAlertsComponent', () => {
  function setup(options: { list?: unknown; unread?: number } = {}) {
    const unread = signal(options.unread ?? 2);
    const service = {
      unread: unread.asReadonly(),
      list: vi.fn().mockReturnValue(options.list ?? of(listOf([note('a'), note('b', { isRead: true })]))),
      markRead: vi.fn().mockReturnValue(of(0)),
    };
    const alerts = { error: vi.fn() };
    const router = { navigateByUrl: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: StockAlertService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: Router, useValue: router },
      ],
    });
    const fixture = TestBed.createComponent(StockAlertsComponent);
    fixture.detectChanges();
    return { fixture, service, alerts, router, vm: fixture.componentInstance as unknown as Vm, el: fixture.nativeElement as HTMLElement, unread };
  }

  const rows = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="alert-row"]')] as HTMLElement[];

  it('lists the alerts and highlights the unread ones', () => {
    const { el } = setup();
    const listed = rows(el);

    expect(listed.length).toBe(2);
    expect(listed[0].textContent).toContain('Low stock: Oat Milk a');
    expect(listed[0].getAttribute('data-unread')).toBe('true');
    expect(listed[1].getAttribute('data-unread')).toBe('false');
    expect(listed[0].textContent).toContain('Low');
  });

  it('labels the three levels', () => {
    const { el } = setup({
      list: of(listOf([note('a'), note('b', { status: 'Critical' }), note('c', { status: 'OutOfStock' })])),
    });
    const text = rows(el).map((row) => row.textContent);

    expect(text[0]).toContain('Low');
    expect(text[1]).toContain('Critical');
    expect(text[2]).toContain('Out');
  });

  it('says so when there are no alerts', () => {
    const { el } = setup({ list: of(listOf([])), unread: 0 });
    expect(rows(el).length).toBe(0);
    expect(el.textContent).toContain('No stock alerts');
  });

  it('opening an unread alert marks it read and goes to the item', () => {
    const { vm, service, router, fixture, el } = setup();
    rows(el)[0].click();
    fixture.detectChanges();

    expect(service.markRead).toHaveBeenCalledWith(['a']);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/inventory/items/details/item-a');
    expect(rows(el)[0].getAttribute('data-unread')).toBe('false');
    expect(vm).toBeTruthy();
  });

  it('opening an alert that is already read does not mark it again', () => {
    const { service, router, el } = setup();
    rows(el)[1].click();

    expect(service.markRead).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/inventory/items/details/item-b');
  });

  it('marks everything read', () => {
    const { vm, service, fixture, el } = setup();
    vm.markAllRead();
    fixture.detectChanges();

    expect(service.markRead).toHaveBeenCalledWith();
    expect(rows(el).every((row) => row.getAttribute('data-unread') === 'false')).toBe(true);
  });

  it('does not mark anything when nothing is unread', () => {
    const { vm, service } = setup({ unread: 0 });
    vm.markAllRead();
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it('loads the next page and appends it', () => {
    const first = Array.from({ length: 25 }, (_, i) => note(`n${i}`));
    const { vm, service, fixture, el } = setup({ list: of(listOf(first, 30)) });
    service.list.mockReturnValue(of(listOf([note('n25')], 26)));
    expect(el.textContent).toContain('Load More');

    vm.load(false);
    fixture.detectChanges();

    expect(service.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 25 });
    expect(rows(el).length).toBe(26);
    expect(el.textContent).not.toContain('Load More');
  });

  it('shows the server message when loading fails', () => {
    const { alerts } = setup({ list: throwError(() => new Error('Down')) });
    expect(alerts.error).toHaveBeenCalledWith('Down');
  });
});
