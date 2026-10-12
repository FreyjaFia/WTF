import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, ElementRef, inject, input, model, output, signal, viewChild } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';
import {
  CHAT_IMAGE_ACCEPT,
  CHAT_IMAGE_TYPES,
  ChatImageMessages,
  ChatImageSend,
  ConversationMessageDto,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_MESSAGE_LENGTH,
} from '@shared/models';
import { ChatImageComponent, ChatImageLoader } from './chat-image';
import { ChatLightboxComponent } from './chat-lightbox';

/**
 * The messages of one chat and a box to write in. It only shows what it is given: the page loads the messages, sends
 * the text (or the picture with its text) and clears the draft once the send worked, so a failed send keeps what was
 * typed and chosen. Messages are shown as plain text, never as HTML.
 */
@Component({
  selector: 'app-chat',
  imports: [DatePipe, IconComponent, ChatImageComponent, ChatLightboxComponent],
  templateUrl: './chat.html',
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class ChatComponent {
  public readonly messages = input.required<ConversationMessageDto[]>();
  /** Which side is looking: its own messages sit on the right. */
  public readonly viewer = input<'staff' | 'customer'>('staff');
  /** What to call the customer's messages, e.g. their name, when staff look. */
  public readonly customerLabel = input('Customer');
  public readonly canSend = input(true);
  public readonly closedReason = input<string | null>(null);
  public readonly isLoading = input(false);
  public readonly isSending = input(false);
  public readonly error = input<string | null>(null);
  public readonly emptyText = input('No messages yet.');

  /** How a message's picture is fetched. Without it the chat cannot show or send pictures. */
  public readonly imageLoader = input<ChatImageLoader | null>(null);
  /** Staff can take a picture out of the chat. */
  public readonly canRemoveImages = input(false);

  /** The text being typed. The page empties it when a send succeeds. */
  public readonly draft = model('');
  /** The picture chosen to send. The page empties it when a send succeeds. */
  public readonly attachment = model<File | null>(null);

  public readonly sent = output<string>();
  public readonly sentImage = output<ChatImageSend>();
  public readonly removeImage = output<ConversationMessageDto>();

  protected readonly maxLength = MAX_CHAT_MESSAGE_LENGTH;
  protected readonly accept = CHAT_IMAGE_ACCEPT;
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');
  private readonly destroyRef = inject(DestroyRef);

  /** Stays true while the reader is at (or near) the bottom, and the list follows new messages and late-loading pictures. */
  private stickToBottom = true;
  private shownCount = 0;
  private frame = 0;

  protected readonly fileError = signal<string | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  /** False until the list has been put at the newest message, so the first draw is never seen jumping down from the top. */
  protected readonly positioned = signal(false);
  /** The picture shown larger. */
  protected readonly zoomed = signal<string | null>(null);
  /** The message whose "remove photo" is waiting for a second tap. */
  protected readonly confirmingRemove = signal<string | null>(null);

  protected readonly canAttach = computed(() => this.imageLoader() !== null);
  protected readonly shownError = computed(() => this.fileError() ?? this.error());
  protected readonly trimmed = computed(() => this.draft().trim());
  protected readonly canSubmit = computed(
    () => this.canSend() && !this.isSending() && (this.trimmed().length > 0 || this.attachment() !== null),
  );
  protected readonly showCounter = computed(() => this.draft().length >= this.maxLength * 0.8);

  public constructor() {
    this.destroyRef.onDestroy(() => cancelAnimationFrame(this.frame));

    // The chat opens at the newest message, and follows new ones. Someone who scrolled up to read is left where they are,
    // unless the new message is their own.
    effect(() => {
      const messages = this.messages();
      const last = messages.at(-1);
      if (this.shownCount === 0 || (last !== undefined && this.isMine(last))) {
        this.stickToBottom = true;
      }

      this.shownCount = messages.length;
      if (messages.length === 0) {
        this.positioned.set(true);
      } else if (this.list() && (this.stickToBottom || !this.positioned())) {
      // The first messages to arrive are put at the bottom while hidden, even if an empty list was already showing.
      if (this.shownCount === 0 && messages.length > 0) {
        this.positioned.set(false);
      }

        this.scrollToBottom();
      }
    });

    // Pictures and the first layout change the height after the messages are in, so keep following while at the bottom.
    effect((onCleanup) => {
      const content = this.content()?.nativeElement;
      if (!content || typeof ResizeObserver === 'undefined') {
        return;
      }

      const observer = new ResizeObserver(() => {
        if (this.stickToBottom) {
          this.scrollToBottom();
        }
      });
      observer.observe(content);
      onCleanup(() => observer.disconnect());
    });

    // A preview of the chosen picture, released when it changes or goes. It lives only in this page, never on disk.
    effect((onCleanup) => {
      const file = this.attachment();
      if (!file) {
        this.previewUrl.set(null);
        return;
      }

      const url = URL.createObjectURL(file);
      this.previewUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
  }

  protected onScroll(): void {
    const element = this.list()?.nativeElement;
    if (element) {
      this.stickToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    }
  }

  private scrollToBottom(): void {
    const element = this.list()?.nativeElement;
    if (!element) {
      return;
    }

    const go = () => (element.scrollTop = element.scrollHeight);
    queueMicrotask(go);
    // Once more after the browser has laid the new rows out.
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      go();
      this.positioned.set(true);
    });
  }

  protected isMine(message: ConversationMessageDto): boolean {
    return message.sender === this.viewer();
  }

  /** The name over a message from the other side: the staff member's name, or the customer's. */
  protected nameOf(message: ConversationMessageDto): string {
    return message.sender === 'staff' ? (message.senderName ?? 'Shop') : this.customerLabel();
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  /** Enter sends, Shift+Enter makes a new line. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  protected onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // So choosing the same file again still counts as a change.
    input.value = '';
    if (!file) {
      return;
    }

    if (!CHAT_IMAGE_TYPES.includes(file.type)) {
      this.fileError.set(ChatImageMessages.WrongType);
      return;
    }

    if (file.size > MAX_CHAT_IMAGE_BYTES) {
      this.fileError.set(ChatImageMessages.TooBig);
      return;
    }

    this.fileError.set(null);
    this.attachment.set(file);
  }

  protected removeAttachment(): void {
    this.fileError.set(null);
    this.attachment.set(null);
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    const file = this.attachment();
    if (file) {
      this.sentImage.emit({ file, body: this.trimmed() });
      return;
    }

    this.sent.emit(this.trimmed());
  }

  protected zoom(address: string): void {
    this.zoomed.set(address);
  }

  protected closeZoom(): void {
    this.zoomed.set(null);
  }

  /** The first tap asks "remove?", the second does it. */
  protected askRemove(message: ConversationMessageDto): void {
    this.confirmingRemove.set(message.id);
  }

  protected confirmRemove(message: ConversationMessageDto): void {
    this.confirmingRemove.set(null);
    this.removeImage.emit(message);
  }
}
