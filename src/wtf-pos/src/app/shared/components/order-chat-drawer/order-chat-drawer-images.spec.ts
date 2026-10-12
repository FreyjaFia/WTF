import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConversationInboxService, ConversationService, SignalRService } from '@core/services';
import { ConversationMessageDto, OrderConversationDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderChatDrawerComponent } from './order-chat-drawer';

const msg = (id: string, over: Partial<ConversationMessageDto> = {}): ConversationMessageDto => ({
  id,
  sender: 'customer',
  senderName: null,
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

describe('OrderChatDrawerComponent pictures', () => {
  let fixture: ComponentFixture<OrderChatDrawerComponent>;
  let api: {
    getOrderConversation: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    sendImageMessage: ReturnType<typeof vi.fn>;
    getMessageImage: ReturnType<typeof vi.fn>;
    removeMessageImage: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
  };

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
  const png = () => new File([new Uint8Array(10)], 'receipt.png', { type: 'image/png' });

  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    api = {
      getOrderConversation: vi.fn(() => of(chat([msg('1', { hasImage: true, imageWidth: 10, imageHeight: 10 })]))),
      sendMessage: vi.fn(),
      sendImageMessage: vi.fn(() => of(msg('2', { sender: 'staff', senderName: 'Ana Reyes', hasImage: true }))),
      getMessageImage: vi.fn(() => of(new Blob(['x'], { type: 'image/jpeg' }))),
      removeMessageImage: vi.fn(() => of(msg('1', { imageRemoved: true }))),
      markRead: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConversationService, useValue: api },
        { provide: ConversationInboxService, useValue: { markOrderRead: vi.fn() } },
        {
          provide: SignalRService,
          useValue: { orderMessage: new Subject(), startStaffOrdersHub: vi.fn(), stopStaffOrdersHub: vi.fn() },
        },
      ],
    });
    fixture = TestBed.createComponent(OrderChatDrawerComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderId', 'o1');
    fixture.detectChanges();
  });

  afterEach(() => vi.restoreAllMocks());

  it('fetches a customer picture as a file with the staff login, for this order and message', () => {
    expect(api.getMessageImage).toHaveBeenCalledWith('o1', '1');
    expect((q('[data-chat-image-loaded]') as HTMLImageElement).src).toContain('blob:fake');
  });

  it('sends a picture with its caption, shows it, and empties the box', () => {
    chooseFile(png());
    const textbox = q('[data-chat-input]') as HTMLTextAreaElement;
    textbox.value = 'Your drink';
    textbox.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    press();

    expect(api.sendImageMessage).toHaveBeenCalledWith('o1', expect.any(File), 'Your drink');
    expect(el().querySelectorAll('[data-message]').length).toBe(2);
    expect(q('[data-chat-attachment]')).toBeNull();
    expect((q('[data-chat-input]') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the chosen photo and says why when the send is refused', () => {
    api.sendImageMessage.mockReturnValue(throwError(() => new Error('The picture is too big.')));
    chooseFile(png());

    press();

    expect(q('[data-chat-error]')!.textContent).toContain('The picture is too big.');
    expect(q('[data-chat-attachment]')).not.toBeNull();
  });

  it('removes a picture after asking, and the message shows "Photo removed"', () => {
    (q('[data-chat-remove-photo]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (q('[data-chat-remove-yes]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api.removeMessageImage).toHaveBeenCalledWith('o1', '1');
    expect(q('[data-chat-photo-removed]')).not.toBeNull();
    expect(q('[data-chat-image]')).toBeNull();
  });

  it('says why when removing fails, and leaves the picture', () => {
    api.removeMessageImage.mockReturnValue(throwError(() => new Error('Failed to remove the photo.')));

    (q('[data-chat-remove-photo]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (q('[data-chat-remove-yes]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(q('[data-chat-error]')!.textContent).toContain('Failed to remove the photo.');
    expect(q('[data-chat-image]')).not.toBeNull();
  });
});
