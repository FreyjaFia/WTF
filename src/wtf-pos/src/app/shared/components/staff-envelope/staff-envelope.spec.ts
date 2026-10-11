import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService, ConversationInboxService } from '@core/services';
import { ConversationSummaryDto } from '@shared/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffEnvelopeComponent } from './staff-envelope';

const item = (over: Partial<ConversationSummaryDto> = {}): ConversationSummaryDto => ({
  id: 'c1',
  orderId: 'o1',
  orderNumber: 1042,
  title: 'Order #1042',
  customerName: 'Maria Cruz',
  lastMessage: 'Is 5pm ok?',
  lastSender: 'customer',
  lastMessageAt: new Date().toISOString(),
  unreadCount: 1,
  ...over,
});

describe('StaffEnvelopeComponent', () => {
  let fixture: ComponentFixture<StaffEnvelopeComponent>;
  let canRead: boolean;
  let inbox: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    unreadConversations: ReturnType<typeof signal<number>>;
    items: ReturnType<typeof signal<ConversationSummaryDto[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
  };
  let navigate: ReturnType<typeof vi.fn>;

  function setup() {
    fixture = TestBed.createComponent(StaffEnvelopeComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    canRead = true;
    inbox = {
      start: vi.fn(),
      stop: vi.fn(),
      refresh: vi.fn(),
      unreadConversations: signal(2),
      items: signal([item()]),
      isLoading: signal(false),
    };
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { canReadOrders: () => canRead } },
        { provide: ConversationInboxService, useValue: inbox },
        { provide: Router, useValue: { navigate } },
      ],
    });
  });

  it('shows the envelope with the unread count to anyone who can read orders', () => {
    setup();

    expect(el().querySelector('[data-envelope]')).not.toBeNull();
    expect(el().querySelector('[data-envelope-badge]')!.textContent!.trim()).toBe('2');
  });

  it('shows nothing to someone who cannot read orders, and does not start listening', () => {
    canRead = false;
    setup();

    expect(el().querySelector('[data-envelope]')).toBeNull();
    expect(inbox.start).not.toHaveBeenCalled();
  });

  it('starts the shared inbox, and stops it when it goes away', () => {
    setup();
    expect(inbox.start).toHaveBeenCalledTimes(1);

    fixture.destroy();
    expect(inbox.stop).toHaveBeenCalledTimes(1);
  });

  it('does not stop an inbox it never started', () => {
    canRead = false;
    setup();

    fixture.destroy();

    expect(inbox.stop).not.toHaveBeenCalled();
  });

  it('loads the list again each time it is opened', () => {
    setup();

    (el().querySelector('[data-envelope]') as HTMLElement).click();

    expect(inbox.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the conversations', () => {
    setup();
    (el().querySelector('[data-envelope]') as HTMLElement).click();
    fixture.detectChanges();

    expect(el().querySelector('[data-envelope-item]')!.textContent).toContain('Order #1042');
    expect(el().querySelector('[data-envelope-item]')!.textContent).toContain('Maria Cruz');
  });

  it('opens the chat in place, without leaving the page, when a conversation is pressed', () => {
    setup();
    (el().querySelector('[data-envelope]') as HTMLElement).click();
    fixture.detectChanges();

    (el().querySelector('[data-envelope-item]') as HTMLElement).click();
    fixture.detectChanges();

    expect(navigate).not.toHaveBeenCalled();
    expect(el().querySelector('[data-order-chat]')!.getAttribute('aria-hidden')).toBe('false');
    expect(el().querySelector('[data-chat-go-to-order]')).not.toBeNull();
  });

  it('goes to the order from the chat when the button beside the title is pressed', () => {
    setup();
    (el().querySelector('[data-envelope]') as HTMLElement).click();
    fixture.detectChanges();
    (el().querySelector('[data-envelope-item]') as HTMLElement).click();
    fixture.detectChanges();

    (el().querySelector('[data-chat-go-to-order]') as HTMLElement).click();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/orders/details/o1']);
    expect(el().querySelector('[data-order-chat]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('does nothing for a conversation that is not about an order', () => {
    inbox.items.set([item({ orderId: null })]);
    setup();
    (el().querySelector('[data-envelope]') as HTMLElement).click();
    fixture.detectChanges();

    (el().querySelector('[data-envelope-item]') as HTMLElement).click();

    expect(navigate).not.toHaveBeenCalled();
  });
});
