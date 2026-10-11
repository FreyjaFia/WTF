import { DatePipe } from '@angular/common';
import { Component, computed, effect, ElementRef, input, model, output, viewChild } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ConversationMessageDto, MAX_CHAT_MESSAGE_LENGTH } from '@shared/models';

/**
 * The messages of one chat and a box to write in. It only shows what it is given: the page loads the messages, sends
 * the text and clears the draft once the send worked, so a failed send keeps what was typed. Messages are shown as plain
 * text, never as HTML.
 */
@Component({
  selector: 'app-chat',
  imports: [DatePipe, IconComponent],
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

  /** The text being typed. The page empties it when a send succeeds. */
  public readonly draft = model('');

  public readonly sent = output<string>();

  protected readonly maxLength = MAX_CHAT_MESSAGE_LENGTH;
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly trimmed = computed(() => this.draft().trim());
  protected readonly canSubmit = computed(
    () => this.canSend() && !this.isSending() && this.trimmed().length > 0,
  );
  protected readonly showCounter = computed(() => this.draft().length >= this.maxLength * 0.8);

  public constructor() {
    // New messages scroll into view, like any chat.
    effect(() => {
      this.messages();
      const element = this.list()?.nativeElement;
      if (element) {
        queueMicrotask(() => (element.scrollTop = element.scrollHeight));
      }
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

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.sent.emit(this.trimmed());
  }
}
