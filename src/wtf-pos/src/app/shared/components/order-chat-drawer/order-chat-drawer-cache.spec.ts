import { TestBed } from '@angular/core/testing';
import { ConversationInboxService, ConversationService, SignalRService } from '@core/services';
import { OrderConversationDto } from '@shared/models';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { OrderChatDrawerComponent } from './order-chat-drawer';

const chat = (orderId: string, body: string): OrderConversationDto => ({
  conversationId: `c-${orderId}`,
  orderId,
  orderNumber: 1,
  title: `Order ${orderId}`,
  canSend: true,
  closedReason: null,
  unreadCount: 0,
  messages: [{ id: `m-${orderId}`, sender: 'customer', senderName: null, body, createdAt: '2026-10-12T09:00:00' }],
});

describe('OrderChatDrawerComponent reopening a chat', () => {
  function setup() {
    const refresh = new Subject<OrderConversationDto>();
    const getOrderConversation = vi
      .fn()
      .mockReturnValueOnce(of(chat('o1', 'first look')))
      .mockReturnValueOnce(refresh);
    TestBed.configureTestingModule({
      providers: [
        { provide: ConversationService, useValue: { getOrderConversation, markRead: vi.fn(() => of(undefined)) } },
        { provide: ConversationInboxService, useValue: { markOrderRead: vi.fn() } },
        {
          provide: SignalRService,
          useValue: { orderMessage: new Subject(), startStaffOrdersHub: vi.fn(), stopStaffOrdersHub: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(OrderChatDrawerComponent);
    fixture.componentRef.setInput('orderId', 'o1');
    return { fixture, refresh, getOrderConversation };
  }

  const open = (fixture: ReturnType<typeof setup>['fixture'], isOpen: boolean) => {
    fixture.componentRef.setInput('isOpen', isOpen);
    fixture.detectChanges();
  };

  it('shows the chat it already has at once, while the fresh copy is still on its way', () => {
    const { fixture, refresh } = setup();
    open(fixture, true);
    open(fixture, false);

    open(fixture, true);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('first look');
    expect(el.querySelector('.loading')).toBeNull();

    refresh.next(chat('o1', 'updated copy'));
    fixture.detectChanges();
    expect(el.textContent).toContain('updated copy');
  });

  it('starts from nothing for an order it has not opened before', () => {
    const { fixture, getOrderConversation } = setup();
    getOrderConversation.mockReset();
    getOrderConversation.mockReturnValueOnce(of(chat('o1', 'first look'))).mockReturnValueOnce(new Subject());
    open(fixture, true);
    open(fixture, false);

    fixture.componentRef.setInput('orderId', 'o2');
    open(fixture, true);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('first look');
    expect(el.querySelector('.loading')).not.toBeNull();
  });
});
