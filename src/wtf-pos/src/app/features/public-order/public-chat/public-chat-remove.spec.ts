import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { PublicLinkInvalidError, PublicOrderService } from '@core/services/public-order.service';
import { ConversationMessageDto, OrderConversationDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicChatComponent } from './public-chat';

const msg = (id: string, over: Partial<ConversationMessageDto> = {}): ConversationMessageDto => ({
  id,
  sender: 'staff',
  senderName: 'Ana',
  body: '',
  createdAt: '2026-10-12T09:00:00',
  ...over,
});

const chat = (messages: ConversationMessageDto[]): OrderConversationDto => ({
  conversationId: 'c1',
  orderId: 'o1',
  orderNumber: 1042,
  title: 'Order #1042',
  canSend: true,
  closedReason: null,
  unreadCount: 0,
  messages,
});

describe('PublicChatComponent removing a photo', () => {
  let fixture: ComponentFixture<PublicChatComponent>;
  let service: {
    getOrderConversation: ReturnType<typeof vi.fn>;
    removeMessageImage: ReturnType<typeof vi.fn>;
    messageImageUrl: ReturnType<typeof vi.fn>;
    markConversationRead: ReturnType<typeof vi.fn>;
  };
  let invalid: ReturnType<typeof vi.fn<() => void>>;

  const mine = msg('1', { sender: 'customer', senderName: null, hasImage: true, imageWidth: 10, imageHeight: 10 });
  const theirs = msg('2', { hasImage: true, imageWidth: 10, imageHeight: 10 });
  const q = (selector: string) => (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLElement | null;
  const all = (selector: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll(selector)] as HTMLElement[];
  const click = (selector: string) => {
    (q(selector) as HTMLElement).click();
    fixture.detectChanges();
  };

  beforeEach(() => {
    service = {
      getOrderConversation: vi.fn(() => of(chat([mine, theirs]))),
      removeMessageImage: vi.fn(() => of(msg('1', { sender: 'customer', senderName: null, imageRemoved: true }))),
      messageImageUrl: vi.fn(() => 'https://api.test/pic'),
      markConversationRead: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PublicOrderService, useValue: service },
        { provide: PublicOrderHubService, useValue: { orderMessage: new Subject().asObservable() } },
      ],
    });
    fixture = TestBed.createComponent(PublicChatComponent);
    invalid = vi.fn<() => void>();
    fixture.componentInstance.linkInvalid.subscribe(invalid);
    fixture.componentRef.setInput('token', 'tok-1');
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderId', 'o1');
    fixture.detectChanges();
  });

  it("offers Remove photo on the customer's own picture only, not on the shop's", () => {
    expect(all('[data-chat-remove-photo]').length).toBe(1);
    expect(all('[data-message]')[0].querySelector('[data-chat-remove-photo]')).not.toBeNull();
    expect(all('[data-message]')[1].querySelector('[data-chat-remove-photo]')).toBeNull();
  });

  it('asks first, then removes it with the link token, and the message says Photo removed', () => {
    click('[data-chat-remove-photo]');
    expect(service.removeMessageImage).not.toHaveBeenCalled();

    click('[data-chat-remove-yes]');

    expect(service.removeMessageImage).toHaveBeenCalledWith('tok-1', 'o1', '1');
    expect(q('[data-chat-photo-removed]')).not.toBeNull();
    expect(all('[data-chat-image]').length).toBe(1);
  });

  it('says why when it cannot be removed, and shows the chat as it is now', () => {
    service.removeMessageImage.mockReturnValue(
      throwError(() => new Error('This order is finished, so the chat is closed.')),
    );
    const loads = service.getOrderConversation.mock.calls.length;

    click('[data-chat-remove-photo]');
    click('[data-chat-remove-yes]');

    expect(q('[data-chat-error]')!.textContent).toContain('finished');
    expect(service.getOrderConversation.mock.calls.length).toBe(loads + 1);
    expect(invalid).not.toHaveBeenCalled();
  });

  it('tells the page when the link stopped working while removing', () => {
    service.removeMessageImage.mockReturnValue(throwError(() => new PublicLinkInvalidError()));

    click('[data-chat-remove-photo]');
    click('[data-chat-remove-yes]');

    expect(invalid).toHaveBeenCalledTimes(1);
  });
});
