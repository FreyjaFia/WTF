import { TestBed } from '@angular/core/testing';
import { ConversationInboxService, ConversationService, SignalRService } from '@core/services';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { PublicOrderService } from '@core/services/public-order.service';
import { OrderChatDrawerComponent } from '@shared/components/order-chat-drawer/order-chat-drawer';
import { PublicChatComponent } from '@features/public-order/public-chat/public-chat';
import { OrderConversationDto } from '@shared/models';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ChatComponent } from './chat';

const conversation = (over: Partial<OrderConversationDto> = {}): OrderConversationDto => ({
  conversationId: 'c1',
  orderId: 'o1',
  orderNumber: 1042,
  title: 'Order #1042',
  canSend: true,
  closedReason: null,
  unreadCount: 0,
  messages: [],
  ...over,
});

const note = (root: HTMLElement) => root.querySelector('[data-chat-retention]');

describe('Chat retention note', () => {
  it('tells the reader how long messages are kept', () => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('retentionDays', 90);
    fixture.detectChanges();

    expect(note(fixture.nativeElement)!.textContent).toContain('Messages are deleted after 90 days once the order is finished.');
  });

  it('says nothing when messages are kept for ever', () => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('messages', []);
    fixture.detectChanges();

    expect(note(fixture.nativeElement)).toBeNull();
  });

  it('is still shown on a finished order, where the box is closed', () => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('retentionDays', 30);
    fixture.componentRef.setInput('canSend', false);
    fixture.detectChanges();

    expect(note(fixture.nativeElement)!.textContent).toContain('30 days');
  });

  it('shows in the staff panel from what the server sends', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ConversationService,
          useValue: {
            getOrderConversation: vi.fn(() => of(conversation({ retentionDays: 90 }))),
            markRead: vi.fn(() => of(undefined)),
          },
        },
        { provide: ConversationInboxService, useValue: { markOrderRead: vi.fn() } },
        {
          provide: SignalRService,
          useValue: { orderMessage: new Subject(), startStaffOrdersHub: vi.fn(), stopStaffOrdersHub: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(OrderChatDrawerComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderId', 'o1');
    fixture.detectChanges();

    expect(note(fixture.nativeElement)!.textContent).toContain('90 days');
  });

  it('shows on the customer sheet from what the server sends', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PublicOrderService,
          useValue: {
            getOrderConversation: vi.fn(() => of(conversation({ retentionDays: 90 }))),
            markConversationRead: vi.fn(() => of(undefined)),
          },
        },
        { provide: PublicOrderHubService, useValue: { orderMessage: new Subject().asObservable() } },
      ],
    });
    const fixture = TestBed.createComponent(PublicChatComponent);
    fixture.componentRef.setInput('token', 'tok-1');
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderId', 'o1');
    fixture.detectChanges();

    expect(note(fixture.nativeElement)!.textContent).toContain('90 days');
  });

  it('is hidden on the customer sheet when the server keeps messages', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PublicOrderService,
          useValue: {
            getOrderConversation: vi.fn(() => of(conversation({ retentionDays: null }))),
            markConversationRead: vi.fn(() => of(undefined)),
          },
        },
        { provide: PublicOrderHubService, useValue: { orderMessage: new Subject().asObservable() } },
      ],
    });
    const fixture = TestBed.createComponent(PublicChatComponent);
    fixture.componentRef.setInput('token', 'tok-1');
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderId', 'o1');
    fixture.detectChanges();

    expect(note(fixture.nativeElement)).toBeNull();
  });
});
