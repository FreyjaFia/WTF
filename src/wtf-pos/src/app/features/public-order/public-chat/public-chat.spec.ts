import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalStackService } from '@core/services';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { PublicLinkInvalidError, PublicOrderService } from '@core/services/public-order.service';
import { ConversationMessageDto, OrderConversationDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicChatComponent } from './public-chat';

const msg = (id: string, sender: 'customer' | 'staff', body: string): ConversationMessageDto => ({
  id,
  sender,
  senderName: sender === 'staff' ? 'Ana' : null,
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
  messages: [msg('1', 'staff', 'Ready at 5')],
  ...over,
});

const CLOSED = 'This order is finished, so the chat is closed.';

describe('PublicChatComponent', () => {
  let fixture: ComponentFixture<PublicChatComponent>;
  let service: {
    getOrderConversation: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    markConversationRead: ReturnType<typeof vi.fn>;
  };
  let message$: Subject<{ conversationId: string; orderId: string }>;
  let modalStack: ModalStackService;

  function setup(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(PublicChatComponent);
    fixture.componentRef.setInput('token', 'tok-1');
    for (const [key, value] of Object.entries({ isOpen: true, orderId: 'o1', ...inputs })) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const rows = () => [...el().querySelectorAll('[data-message]')];
  const sheet = () => el().querySelector('[data-public-chat]') as HTMLElement;
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
    service = {
      getOrderConversation: vi.fn(() => of(chat())),
      sendMessage: vi.fn(() => of(msg('2', 'customer', 'Thanks!'))),
      markConversationRead: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PublicOrderService, useValue: service },
        { provide: PublicOrderHubService, useValue: { orderMessage: message$.asObservable() } },
      ],
    });
    modalStack = TestBed.inject(ModalStackService);
  });

  describe('opening', () => {
    it('loads nothing while closed', () => {
      setup({ isOpen: false });

      expect(service.getOrderConversation).not.toHaveBeenCalled();
    });

    it('loads the chat of the order with the link token, and shows it', () => {
      setup();

      expect(service.getOrderConversation).toHaveBeenCalledWith('tok-1', 'o1');
      expect(el().querySelector('[data-chat-title]')!.textContent).toContain('Order #1042');
      expect(text()).toContain('Chat with the shop');
      expect(rows().length).toBe(1);
      expect(text()).toContain('Ready at 5');
    });

    it('shows the shops messages by first name, and the customers own on the right', () => {
      service.getOrderConversation.mockReturnValue(
        of(chat({ messages: [msg('1', 'staff', 'Ready at 5'), msg('2', 'customer', 'Great')] })),
      );
      setup();

      expect(rows()[0].textContent).toContain('Ana');
      expect(rows()[0].getAttribute('data-mine')).toBe('false');
      expect(rows()[1].getAttribute('data-mine')).toBe('true');
    });

    it('is the same panel as the staff chat: full height, sliding in from the right, on every screen', () => {
      setup();
      expect(sheet().className).toContain('translate-x-0');
      expect(sheet().className).toContain('h-full');
      expect(sheet().className).not.toContain('translate-y');
      expect(sheet().className).not.toContain('rounded-t-2xl');

      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();
      expect(sheet().className).toContain('translate-x-full');
    });

    it('titles itself from the order number before the chat has loaded', () => {
      service.getOrderConversation.mockReturnValue(new Subject());
      setup({ orderNumber: 1042 });

      expect(el().querySelector('[data-chat-title]')!.textContent).toContain('Order #1042');
    });

    it('registers with the modal stack, so the back button closes it', () => {
      setup();

      expect(modalStack.hasOpen()).toBe(true);
    });

    it('starts from nothing for another order', () => {
      setup();
      service.getOrderConversation.mockReturnValue(of(chat({ orderId: 'o2', title: 'Order #7', messages: [] })));
      fixture.componentRef.setInput('orderId', 'o2');
      fixture.detectChanges();

      expect(service.getOrderConversation).toHaveBeenLastCalledWith('tok-1', 'o2');
      expect(rows().length).toBe(0);
    });
  });

  describe('reading', () => {
    it('marks the shops replies read, and tells the page so its badges drop', () => {
      service.getOrderConversation.mockReturnValue(of(chat({ unreadCount: 2 })));
      setup();
      const changed = vi.fn();
      fixture.componentInstance.changed.subscribe(changed);
      service.getOrderConversation.mockReturnValue(of(chat({ unreadCount: 1 })));

      message$.next({ conversationId: 'c1', orderId: 'o1' });

      expect(service.markConversationRead).toHaveBeenCalledWith('tok-1', 'o1');
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('marks nothing read when nothing is unread', () => {
      setup();

      expect(service.markConversationRead).not.toHaveBeenCalled();
    });

    it('survives a failure to mark read', () => {
      service.getOrderConversation.mockReturnValue(of(chat({ unreadCount: 1 })));
      service.markConversationRead.mockReturnValue(throwError(() => new Error('offline')));

      expect(() => setup()).not.toThrow();
    });
  });

  describe('live messages', () => {
    it('loads the chat again when a message for this order arrives', () => {
      setup();
      service.getOrderConversation.mockReturnValue(
        of(chat({ messages: [msg('1', 'staff', 'Ready at 5'), msg('3', 'staff', 'Where are you?')] })),
      );

      message$.next({ conversationId: 'c1', orderId: 'o1' });
      fixture.detectChanges();

      expect(rows().length).toBe(2);
      expect(text()).toContain('Where are you?');
    });

    it('ignores another order, and stops listening once closed', () => {
      setup();
      service.getOrderConversation.mockClear();

      message$.next({ conversationId: 'c9', orderId: 'other' });
      expect(service.getOrderConversation).not.toHaveBeenCalled();

      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();
      message$.next({ conversationId: 'c1', orderId: 'o1' });
      expect(service.getOrderConversation).not.toHaveBeenCalled();
      expect(modalStack.hasOpen()).toBe(false);
    });
  });

  describe('writing', () => {
    it('sends the text to the shop with the token, shows it and empties the box', () => {
      setup();

      type('Thanks!');
      press();

      expect(service.sendMessage).toHaveBeenCalledWith('tok-1', 'o1', 'Thanks!');
      expect(rows().length).toBe(2);
      expect(input().value).toBe('');
    });

    it('keeps the text and says why when sending fails, and shows the chat as it is now', () => {
      setup();
      service.sendMessage.mockReturnValue(throwError(() => new Error(CLOSED)));
      service.getOrderConversation.mockReturnValue(of(chat({ canSend: false, closedReason: CLOSED })));

      type('Too late');
      press();

      expect(text()).toContain(CLOSED);
      expect(el().querySelector('[data-chat-closed]')).not.toBeNull();
    });

    it('keeps the draft when a send fails', () => {
      setup();
      service.sendMessage.mockReturnValue(throwError(() => new Error('Please wait for the shop to reply.')));

      type('Hello?');
      press();

      expect(input().value).toBe('Hello?');
      expect(el().querySelector('[data-chat-error]')!.textContent).toContain('Please wait for the shop');
    });

    it('tells the page when the link stopped working while sending', () => {
      setup();
      const invalid = vi.fn();
      fixture.componentInstance.linkInvalid.subscribe(invalid);
      service.sendMessage.mockReturnValue(throwError(() => new PublicLinkInvalidError()));

      type('Hello?');
      press();

      expect(invalid).toHaveBeenCalledTimes(1);
      expect(el().querySelector('[data-chat-error]')).toBeNull();
    });

    it('does not send twice while one is on its way', () => {
      setup();
      service.sendMessage.mockReturnValue(new Subject());

      type('One');
      press();
      type('Two');
      press();

      expect(service.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('a finished order', () => {
    it('shows the history, no box, and says why', () => {
      service.getOrderConversation.mockReturnValue(of(chat({ canSend: false, closedReason: CLOSED })));
      setup();

      expect(rows().length).toBe(1);
      expect(input()).toBeNull();
      expect(el().querySelector('[data-chat-closed]')!.textContent).toContain('This order is finished');
    });
  });

  describe('problems loading', () => {
    it('says why the chat could not be loaded', () => {
      service.getOrderConversation.mockReturnValue(
        throwError(() => new Error('Failed to load the chat. Please try again.')),
      );
      setup();

      expect(el().querySelector('[data-chat-error]')!.textContent).toContain('Failed to load the chat');
    });

    it('tells the page when the link stopped working while loading', () => {
      service.getOrderConversation.mockReturnValue(throwError(() => new PublicLinkInvalidError()));
      fixture = TestBed.createComponent(PublicChatComponent);
      const invalid = vi.fn();
      fixture.componentInstance.linkInvalid.subscribe(invalid);
      fixture.componentRef.setInput('token', 'tok-1');
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('orderId', 'o1');
      fixture.detectChanges();

      expect(invalid).toHaveBeenCalledTimes(1);
    });

    it('stays quiet when a background refresh fails', () => {
      setup();
      service.getOrderConversation.mockReturnValue(throwError(() => new Error('offline')));

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
      sheet().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(closed).toHaveBeenCalledTimes(3);
    });

    it('stops listening when the page goes away while it is open', () => {
      setup();

      fixture.destroy();
      service.getOrderConversation.mockClear();
      message$.next({ conversationId: 'c1', orderId: 'o1' });

      expect(service.getOrderConversation).not.toHaveBeenCalled();
      expect(modalStack.hasOpen()).toBe(false);
    });
  });
});
