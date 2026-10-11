import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConversationSummaryDto } from '@shared/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvelopeComponent } from './envelope';

const item = (id: string, over: Partial<ConversationSummaryDto> = {}): ConversationSummaryDto => ({
  id,
  orderId: 'o-' + id,
  orderNumber: 1042,
  title: 'Order #1042',
  customerName: 'Maria Cruz',
  lastMessage: 'Is 5pm ok?',
  lastSender: 'customer',
  lastMessageAt: new Date().toISOString(),
  unreadCount: 0,
  ...over,
});

describe('EnvelopeComponent', () => {
  let fixture: ComponentFixture<EnvelopeComponent>;

  function setup(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(EnvelopeComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const button = () => el().querySelector('[data-envelope]') as HTMLButtonElement;
  const badge = () => el().querySelector('[data-envelope-badge]');
  const panel = () => el().querySelector('[data-envelope-panel]') as HTMLElement | null;
  const rows = () => [...el().querySelectorAll('[data-envelope-item]')] as HTMLElement[];

  const open = () => {
    button().click();
    fixture.detectChanges();
  };

  afterEach(() => vi.useRealTimers());

  describe('the badge', () => {
    it('shows nothing when nothing is unread', () => {
      setup();

      expect(badge()).toBeNull();
      expect(button().getAttribute('aria-label')).toBe('Messages');
    });

    it('shows how many conversations are unread', () => {
      setup({ unread: 3 });

      expect(badge()!.textContent!.trim()).toBe('3');
      expect(button().getAttribute('aria-label')).toBe('Messages, 3 unread');
    });

    it('stops counting at 99', () => {
      setup({ unread: 100 });

      expect(badge()!.textContent!.trim()).toBe('99+');
    });
  });

  describe('opening', () => {
    it('opens the list when pressed, and closes it when pressed again', () => {
      setup();
      expect(panel()).toBeNull();

      open();
      expect(panel()).not.toBeNull();
      expect(button().getAttribute('aria-expanded')).toBe('true');

      open();
      expect(panel()).toBeNull();
    });

    it('tells the page when the list is opened, so it can load it again, but not when it closes', () => {
      setup();
      const opened = vi.fn();
      fixture.componentInstance.listOpened.subscribe(opened);

      open();
      open();

      expect(opened).toHaveBeenCalledTimes(1);
    });

    it('closes on a press outside, but not inside', () => {
      setup({ items: [item('1')] });
      open();

      panel()!.click();
      document.body.click();
      fixture.detectChanges();

      expect(panel()).toBeNull();
    });

    it('closes with Escape', () => {
      setup();
      open();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();

      expect(panel()).toBeNull();
    });

    it('hangs from the right or the left on wide screens', () => {
      setup({ align: 'start' });
      open();
      expect(panel()!.className).toContain('sm:left-0');

      setup({ align: 'end' });
      open();
      expect(panel()!.className).toContain('sm:right-0');
    });
  });

  describe('the list', () => {
    it('says so when there are no conversations', () => {
      setup();
      open();

      expect(el().querySelector('[data-envelope-empty]')!.textContent).toContain('No messages yet.');
    });

    it('shows a spinner on the first load, but the list while refreshing', () => {
      setup({ isLoading: true });
      open();
      expect(el().querySelector('.loading-spinner')).not.toBeNull();

      setup({ isLoading: true, items: [item('1')] });
      open();
      expect(el().querySelector('.loading-spinner')).toBeNull();
      expect(rows().length).toBe(1);
    });

    it('shows the order, who it is with and the last message', () => {
      setup({ items: [item('1')] });
      open();

      const text = rows()[0].textContent!;
      expect(text).toContain('Order #1042');
      expect(text).toContain('Maria Cruz');
      expect(text).toContain('Customer: Is 5pm ok?');
    });

    it('does not repeat the customers name for a customer', () => {
      setup({ items: [item('1')], showCustomer: false, viewer: 'customer' });
      open();

      expect(rows()[0].textContent).not.toContain('Maria Cruz');
    });

    it.each([
      ['staff', 'staff', 'You: hello'],
      ['staff', 'customer', 'Customer: hello'],
      ['customer', 'customer', 'You: hello'],
      ['customer', 'staff', 'Shop: hello'],
    ] as const)('words a preview for the %s viewer when the last message was from the %s', (viewer, lastSender, expected) => {
      setup({ viewer, items: [item('1', { lastSender, lastMessage: 'hello' })] });
      open();

      expect(rows()[0].textContent).toContain(expected);
    });

    it('shows an order update as it is, with nobody named as the writer', () => {
      setup({ items: [item('1', { lastSender: 'system', lastMessage: 'Order accepted' })] });
      open();

      expect(rows()[0].textContent).toContain('Order accepted');
      expect(rows()[0].textContent).not.toContain('Shop:');
      expect(rows()[0].textContent).not.toContain('Customer:');
    });

    it('says there are no messages in a conversation that has none yet', () => {
      setup({ items: [item('1', { lastMessage: '', lastSender: '' })] });
      open();

      expect(rows()[0].textContent).toContain('No messages yet');
    });

    it('marks what is unread, with its count', () => {
      setup({ unread: 1, items: [item('1', { unreadCount: 3 }), item('2')] });
      open();

      expect(rows()[0].dataset['unread']).toBe('true');
      expect(rows()[0].querySelector('[data-envelope-item-count]')!.textContent!.trim()).toBe('3');
      expect(rows()[0].querySelector('.font-bold')).not.toBeNull();
      expect(rows()[1].dataset['unread']).toBe('false');
      expect(rows()[1].querySelector('[data-envelope-item-count]')).toBeNull();
    });

    it('opens that conversation when a row is pressed, and closes the list', () => {
      setup({ items: [item('1'), item('2', { title: 'Order #7' })] });
      const opened = vi.fn();
      fixture.componentInstance.opened.subscribe(opened);
      open();

      rows()[1].click();
      fixture.detectChanges();

      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ id: '2', title: 'Order #7' }));
      expect(panel()).toBeNull();
    });
  });

  describe('how long ago', () => {
    const ago = (iso: string) =>
      (fixture.componentInstance as unknown as { ago: (value: string) => string }).ago(iso);
    const before = (ms: number) => new Date(Date.now() - ms).toISOString();

    it.each([
      [10_000, 'now'],
      [5 * 60_000, '5m'],
      [3 * 3_600_000, '3h'],
      [2 * 86_400_000, '2d'],
    ])('%i ms ago is %s', (ms, expected) => {
      setup();

      expect(ago(before(ms))).toBe(expected);
    });

    it('shows the date after a week', () => {
      setup();

      expect(ago(new Date('2026-01-05T10:00:00').toISOString())).toBe('Jan 5');
    });
  });
});
