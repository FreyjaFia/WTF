import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ConversationInboxService,
  ConversationService,
  ModalStackService,
  SignalRService,
} from '@core/services';
import { ConversationMessageDto, OrderConversationDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderChatDrawerComponent } from './order-chat-drawer';

const msg = (id: string, sender: 'customer' | 'staff', body: string): ConversationMessageDto => ({
  id,
  sender,
  senderName: sender === 'staff' ? 'Ana Reyes' : null,
  body,
  createdAt: '2026-10-12T09:00:00',
});

const chat = (over: Partial<OrderConversationDto> = {}): OrderConversationDto => ({
  conversationId: 'c1',
  orderId: 'o1',
  orderNumber: 1042,
  title: 'Order #1042',
  canSend: true,
  closedReason: null,
  unreadCount: 0,
  messages: [msg('1', 'customer', 'Is 5pm ok?')],
  ...over,
});

const CLOSED = 'This order is finished, so the chat is closed.';

describe('OrderChatDrawerComponent', () => {
  let fixture: ComponentFixture<OrderChatDrawerComponent>;
  let api: {
    getOrderConversation: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
  };
  let inbox: { markOrderRead: ReturnType<typeof vi.fn> };
  let message$: Subject<{ conversationId: string; orderId: string }>;
  let signalR: {
    orderMessage: Subject<{ conversationId: string; orderId: string }>;
    startStaffOrdersHub: ReturnType<typeof vi.fn>;
    stopStaffOrdersHub: ReturnType<typeof vi.fn>;
  };
  let modalStack: ModalStackService;

  function setup(inputs: Record<string, unknown> = { isOpen: true, orderId: 'o1' }) {
    fixture = TestBed.createComponent(OrderChatDrawerComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const rows = () => [...el().querySelectorAll('[data-message]')];
  const input = () => el().querySelector('[data-chat-input]') as HTMLTextAreaElement;
  const type = (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const press = () => {
    (el().querySelector('[data-chat-send]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  beforeEach(() => {
    message$ = new Subject();
    api = {
      getOrderConversation: vi.fn(() => of(chat())),
      sendMessage: vi.fn(() => of(msg('2', 'staff', 'Yes!'))),
      markRead: vi.fn(() => of(undefined)),
    };
    inbox = { markOrderRead: vi.fn() };
    signalR = { orderMessage: message$, startStaffOrdersHub: vi.fn(), stopStaffOrdersHub: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConversationService, useValue: api },
        { provide: ConversationInboxService, useValue: inbox },
        { provide: SignalRService, useValue: signalR },
      ],
    });
    modalStack = TestBed.inject(ModalStackService);
  });

  describe('opening', () => {
    it('loads nothing while closed', () => {
      setup({ isOpen: false, orderId: 'o1' });

      expect(api.getOrderConversation).not.toHaveBeenCalled();
      expect(signalR.startStaffOrdersHub).not.toHaveBeenCalled();
    });

    it('loads the chat of the order when opened, and shows it with its title', () => {
      setup({ isOpen: true, orderId: 'o1', customerName: 'Maria Cruz' });

      expect(api.getOrderConversation).toHaveBeenCalledWith('o1');
      expect(el().querySelector('[data-chat-title]')!.textContent).toContain('Order #1042');
      expect(text()).toContain('Maria Cruz');
      expect(rows().length).toBe(1);
      expect(text()).toContain('Is 5pm ok?');
    });

    it('titles the panel from the order number before the chat has loaded', () => {
      api.getOrderConversation.mockReturnValue(new Subject());
      setup({ isOpen: true, orderId: 'o1', orderNumber: 1042 });

      expect(el().querySelector('[data-chat-title]')!.textContent).toContain('Order #1042');
    });

    it('listens for new messages while open', () => {
      setup();

      expect(signalR.startStaffOrdersHub).toHaveBeenCalledTimes(1);
    });

    it('registers with the modal stack, so the back button closes it', () => {
      setup();

      expect(modalStack.hasOpen()).toBe(true);
    });

    it('starts again from nothing for another order', () => {
      setup();
      fixture.componentRef.setInput('orderId', 'o2');
      api.getOrderConversation.mockReturnValue(
        of(chat({ orderId: 'o2', title: 'Order #7', messages: [] })),
      );
      fixture.detectChanges();

      expect(api.getOrderConversation).toHaveBeenLastCalledWith('o2');
      expect(el().querySelector('[data-chat-title]')!.textContent).toContain('Order #7');
      expect(rows().length).toBe(0);
    });
  });

  describe('reading', () => {
    it('marks the customers messages read for everyone, and clears the badge at once', () => {
      api.getOrderConversation.mockReturnValue(of(chat({ unreadCount: 2 })));
      setup();

      expect(inbox.markOrderRead).toHaveBeenCalledWith('o1');
      expect(api.markRead).toHaveBeenCalledWith('o1');
    });

    it('does not mark anything read when nothing is unread', () => {
      setup();

      expect(inbox.markOrderRead).not.toHaveBeenCalled();
      expect(api.markRead).not.toHaveBeenCalled();
    });

    it('ignores a failure to mark read', () => {
      api.getOrderConversation.mockReturnValue(of(chat({ unreadCount: 1 })));
      api.markRead.mockReturnValue(throwError(() => new Error('offline')));

      expect(() => setup()).not.toThrow();
    });
  });

  describe('live messages', () => {
    it('loads the chat again when a message for this order arrives', () => {
      setup();
      api.getOrderConversation.mockReturnValue(
        of(
          chat({
            messages: [msg('1', 'customer', 'Is 5pm ok?'), msg('3', 'customer', 'Hello?')],
            unreadCount: 1,
          }),
        ),
      );

      message$.next({ conversationId: 'c1', orderId: 'o1' });
      fixture.detectChanges();

      expect(rows().length).toBe(2);
      expect(text()).toContain('Hello?');
      expect(api.markRead).toHaveBeenCalledWith('o1');
    });

    it('ignores messages for another order', () => {
      setup();
      api.getOrderConversation.mockClear();

      message$.next({ conversationId: 'c9', orderId: 'other' });

      expect(api.getOrderConversation).not.toHaveBeenCalled();
    });

    it('does not show a spinner when it refreshes quietly', () => {
      setup();
      api.getOrderConversation.mockReturnValue(new Subject());

      message$.next({ conversationId: 'c1', orderId: 'o1' });
      fixture.detectChanges();

      expect(el().querySelector('.loading-spinner')).toBeNull();
      expect(rows().length).toBe(1);
    });
  });

  describe('replying', () => {
    it('sends the text, shows the reply and empties the box', () => {
      setup();

      type('Yes!');
      press();

      expect(api.sendMessage).toHaveBeenCalledWith('o1', 'Yes!');
      expect(rows().length).toBe(2);
      expect(text()).toContain('Yes!');
      expect(rows()[1].getAttribute('data-mine')).toBe('true');
      expect(input().value).toBe('');
    });

    it('says why when the chat has closed meanwhile, and shows it as it is now', () => {
      setup();
      api.sendMessage.mockReturnValue(throwError(() => new Error(CLOSED)));
      api.getOrderConversation.mockReturnValue(of(chat({ canSend: false, closedReason: CLOSED })));

      type('Too late');
      press();

      expect(text()).toContain(CLOSED);
      expect(el().querySelector('[data-chat-closed]')).not.toBeNull();
    });

    it('keeps the draft when a send fails', () => {
      setup();
      api.sendMessage.mockReturnValue(throwError(() => new Error('offline')));

      type('Hello again');
      press();

      expect(input().value).toBe('Hello again');
      expect(el().querySelector('[data-chat-error]')!.textContent).toContain('offline');
    });

    it('does not send a second message while one is on its way', () => {
      setup();
      api.sendMessage.mockReturnValue(new Subject());

      type('One');
      press();
      type('Two');
      press();

      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('a finished order', () => {
    it('shows the history but no box', () => {
      api.getOrderConversation.mockReturnValue(of(chat({ canSend: false, closedReason: CLOSED })));
      setup();

      expect(rows().length).toBe(1);
      expect(input()).toBeNull();
      expect(el().querySelector('[data-chat-closed]')!.textContent).toContain('This order is finished');
    });
  });

  describe('problems', () => {
    it('says why the chat could not be loaded', () => {
      api.getOrderConversation.mockReturnValue(
        throwError(() => new Error('Failed to load the chat. Please try again later.')),
      );
      setup();

      expect(el().querySelector('[data-chat-error]')!.textContent).toContain('Failed to load the chat');
      expect(el().querySelector('.loading-spinner')).toBeNull();
    });

    it('stays quiet when a background refresh fails', () => {
      setup();
      api.getOrderConversation.mockReturnValue(throwError(() => new Error('offline')));

      message$.next({ conversationId: 'c1', orderId: 'o1' });
      fixture.detectChanges();

      expect(el().querySelector('[data-chat-error]')).toBeNull();
      expect(rows().length).toBe(1);
    });
  });

  describe('closing', () => {
    it('asks to close from the button, the backdrop and Escape', () => {
      setup();
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);

      (el().querySelector('[data-chat-close]') as HTMLElement).click();
      (el().querySelector('[role="presentation"]') as HTMLElement).click();
      el()
        .querySelector('[data-order-chat]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(closed).toHaveBeenCalledTimes(3);
    });

    it('stops listening and leaves the modal stack when closed', () => {
      setup();

      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();

      expect(signalR.stopStaffOrdersHub).toHaveBeenCalledTimes(1);
      expect(modalStack.hasOpen()).toBe(false);
      api.getOrderConversation.mockClear();
      message$.next({ conversationId: 'c1', orderId: 'o1' });
      expect(api.getOrderConversation).not.toHaveBeenCalled();
    });

    it('stops listening when the page goes away while it is open', () => {
      setup();

      fixture.destroy();

      expect(signalR.stopStaffOrdersHub).toHaveBeenCalledTimes(1);
    });
  });
});
