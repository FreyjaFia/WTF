import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { PublicLinkInvalidError, PublicOrderService } from '@core/services/public-order.service';
import { ConversationMessageDto, OrderConversationDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('PublicChatComponent pictures', () => {
  let fixture: ComponentFixture<PublicChatComponent>;
  let service: {
    getOrderConversation: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    sendImageMessage: ReturnType<typeof vi.fn>;
    messageImageUrl: ReturnType<typeof vi.fn>;
    markConversationRead: ReturnType<typeof vi.fn>;
  };
  let invalid: ReturnType<typeof vi.fn<() => void>>;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (selector: string) => el().querySelector(selector) as HTMLElement | null;
  const chooseFile = (file: File) => {
    const input = q('[data-chat-file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const press = () => {
    (q('[data-chat-send]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const png = () => new File([new Uint8Array(10)], 'gcash.png', { type: 'image/png' });

  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    service = {
      getOrderConversation: vi.fn(() => of(chat([msg('1', { hasImage: true, imageWidth: 10, imageHeight: 10 })]))),
      sendMessage: vi.fn(),
      sendImageMessage: vi.fn(() => of(msg('2', { sender: 'customer', senderName: null, hasImage: true }))),
      messageImageUrl: vi.fn((token: string, orderId: string, id: string) => `https://api.test/${token}/${orderId}/${id}`),
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

  afterEach(() => vi.restoreAllMocks());

  it('shows the shop picture straight from its address, with nothing downloaded to the device', () => {
    expect(service.messageImageUrl).toHaveBeenCalledWith('tok-1', 'o1', '1');
    expect((q('[data-chat-image-loaded]') as HTMLImageElement).src).toBe('https://api.test/tok-1/o1/1');
    expect(URL.createObjectURL).not.toHaveBeenCalledWith(expect.any(Blob));
  });

  it('never offers the customer a way to remove a picture', () => {
    expect(q('[data-chat-remove-photo]')).toBeNull();
  });

  it('sends a picture with its caption using the link token, and empties the box', () => {
    chooseFile(png());
    const textbox = q('[data-chat-input]') as HTMLTextAreaElement;
    textbox.value = 'Paid by GCash';
    textbox.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    press();

    expect(service.sendImageMessage).toHaveBeenCalledWith('tok-1', 'o1', expect.any(File), 'Paid by GCash');
    expect(el().querySelectorAll('[data-message]').length).toBe(2);
    expect(q('[data-chat-attachment]')).toBeNull();
  });

  it('keeps the photo and shows the shop reason when it is refused', () => {
    service.sendImageMessage.mockReturnValue(
      throwError(() => new Error('You have sent a lot of photos today. Please try again tomorrow.')),
    );
    chooseFile(png());

    press();

    expect(q('[data-chat-error]')!.textContent).toContain('lot of photos today');
    expect(q('[data-chat-attachment]')).not.toBeNull();
    expect(invalid).not.toHaveBeenCalled();
  });

  it('tells the page when the link stopped working while sending a picture', () => {
    service.sendImageMessage.mockReturnValue(throwError(() => new PublicLinkInvalidError()));
    chooseFile(png());

    press();

    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it('does not send a second picture while one is on its way', () => {
    service.sendImageMessage.mockReturnValue(new Subject());
    chooseFile(png());

    press();
    fixture.componentInstance['sendImage']({ file: png(), body: '' });

    expect(service.sendImageMessage).toHaveBeenCalledTimes(1);
  });
});
