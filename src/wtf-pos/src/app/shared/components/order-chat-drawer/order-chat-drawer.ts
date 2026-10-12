import { Component, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { DRAWER_SLIDE_MS } from '@shared/components/drawer-timing';
import { ConversationInboxService, ConversationService, ModalStackService, SignalRService } from '@core/services';
import { ChatComponent } from '@shared/components/chat/chat';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ChatImageLoader } from '@shared/components/chat/chat-image';
import { ChatImageSend, ConversationMessageDto, OrderConversationDto } from '@shared/models';
import { Observable, Subscription } from 'rxjs';

/**
 * The staff side of an order's chat, in a panel that slides in from the right. It loads the chat when opened, marks the
 * customer's messages read for everyone on the staff, shows new messages as they arrive and sends replies. An order
 * that is over keeps its history but cannot be written to.
 */
@Component({
  selector: 'app-order-chat-drawer',
  imports: [ChatComponent, IconComponent],
  templateUrl: './order-chat-drawer.html',
})
export class OrderChatDrawerComponent implements OnDestroy {
  private readonly conversations = inject(ConversationService);
  private readonly inbox = inject(ConversationInboxService);
  private readonly signalR = inject(SignalRService);
  private readonly modalStack = inject(ModalStackService);

  public readonly isOpen = input(false);
  public readonly orderId = input<string | null>(null);
  public readonly orderNumber = input<number | null>(null);
  /** Who the order is for, to label the customer's messages. */
  public readonly customerName = input('Customer');

  public readonly closed = output<void>();
  /** Shows a "Go to order" button, for chats opened away from their order. */
  public readonly canGoToOrder = input(false);
  public readonly goToOrder = output<void>();

  protected readonly conversation = signal<OrderConversationDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly isSending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly attachment = signal<File | null>(null);

  /** Staff fetch a picture as a file (it needs their login), shown from memory only. */
  protected readonly imageLoader: ChatImageLoader = (message) =>
    this.conversations.getMessageImage(this.orderId() ?? '', message.id);

  protected readonly hasTransitions = signal(false);

  /** The chat body exists while the panel is open and for the length of the slide out, so it never empties while moving. */
  protected readonly contentMounted = signal(false);
  /** The messages are drawn once the panel has finished sliding in, so building them does not stutter the slide. */
  protected readonly contentReady = signal(false);
  private slideTimerId: number | null = null;

  /** The chats opened so far, so opening one again shows it at once while it is refreshed in the background. */
  private readonly opened = new Map<string, OrderConversationDto>();

  private modalStackId: number | null = null;
  private initTimerId: number | null = null;
  private liveSubscription: Subscription | null = null;

  public constructor() {
    // Transitions start after the first paint, so a panel never slides while the page is being entered.
    this.initTimerId = window.setTimeout(() => {
      this.hasTransitions.set(true);
      this.initTimerId = null;
    }, 16);

    effect(() => {
      const open = this.isOpen();
      const id = this.orderId();

      untracked(() => {
        if (open && id) {
          this.begin(id);
        } else {
          this.end();
        }
      });
    });
  }

  public ngOnDestroy(): void {
    if (this.initTimerId !== null) {
      window.clearTimeout(this.initTimerId);
    }
    this.end();
    this.clearSlideTimer();
  }

  protected close(): void {
    this.closed.emit();
  }

  protected title(): string {
    return this.conversation()?.title ?? (this.orderNumber() ? `Order #${this.orderNumber()}` : 'Chat');
  }

  protected send(body: string): void {
    this.submit((id) => this.conversations.sendMessage(id, body));
  }

  protected sendImage(upload: ChatImageSend): void {
    this.submit((id) => this.conversations.sendImageMessage(id, upload.file, upload.body));
  }

  /** The message stays and says the photo was removed; the picture itself is deleted on the server. */
  protected removeImage(message: ConversationMessageDto): void {
    const id = this.orderId();
    if (!id) {
      return;
    }

    this.error.set(null);
    this.conversations.removeMessageImage(id, message.id).subscribe({
      next: (updated) =>
        this.conversation.update((current) =>
          current ? { ...current, messages: current.messages.map((m) => (m.id === updated.id ? updated : m)) } : current,
        ),
      error: (err: Error) => this.error.set(err.message),
    });
  }

  private submit(request: (orderId: string) => Observable<ConversationMessageDto>): void {
    const id = this.orderId();
    if (!id || this.isSending()) {
      return;
    }

    this.isSending.set(true);
    this.error.set(null);
    request(id).subscribe({
      next: (message) => {
        this.conversation.update((current) =>
          current && !current.messages.some((m) => m.id === message.id)
            ? { ...current, messages: [...current.messages, message] }
            : current,
        );
        this.draft.set('');
        this.attachment.set(null);
        this.isSending.set(false);
      },
      error: (err: Error) => {
        // The text stays in the box, so nothing is lost.
        this.error.set(err.message);
        this.isSending.set(false);
        // The order may just have finished: show the chat as it is now.
        this.load(id, true);
      },
    });
  }

  private begin(orderId: string): void {
    this.showContent();
    this.conversation.set(this.opened.get(orderId) ?? null);
    this.error.set(null);
    this.draft.set('');
    this.attachment.set(null);
    this.load(orderId, false);

    this.modalStackId ??= this.modalStack.push(() => this.close());
    this.liveSubscription?.unsubscribe();
    this.liveSubscription = this.signalR.orderMessage.subscribe((change) => {
      if (change.orderId === orderId) {
        this.load(orderId, true);
      }
    });
    this.signalR.startStaffOrdersHub();
  }

  private end(): void {
    this.hideContent();
    if (this.liveSubscription) {
      this.liveSubscription.unsubscribe();
      this.liveSubscription = null;
      this.signalR.stopStaffOrdersHub();
    }

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  /** Builds the chat body now; the messages follow when the slide has finished (at once if nothing animates). */
  private showContent(): void {
    this.clearSlideTimer();
    const alreadyShown = this.contentMounted();
    this.contentMounted.set(true);
    if (alreadyShown || !this.hasTransitions()) {
      this.contentReady.set(true);
      return;
    }

    this.contentReady.set(false);
    this.slideTimerId = window.setTimeout(() => {
      this.contentReady.set(true);
      this.slideTimerId = null;
    }, DRAWER_SLIDE_MS);
  }

  /** Keeps the chat body until the panel has slid out, so it does not turn into an empty white panel on the way. */
  private hideContent(): void {
    if (!this.contentMounted()) {
      return;
    }

    this.clearSlideTimer();
    const remove = () => {
      this.contentMounted.set(false);
      this.contentReady.set(false);
      this.slideTimerId = null;
    };
    if (this.hasTransitions()) {
      this.slideTimerId = window.setTimeout(remove, DRAWER_SLIDE_MS);
    } else {
      remove();
    }
  }

  private clearSlideTimer(): void {
    if (this.slideTimerId !== null) {
      window.clearTimeout(this.slideTimerId);
      this.slideTimerId = null;
    }
  }

  private load(orderId: string, silent: boolean): void {
    if (!silent) {
      this.isLoading.set(true);
    }

    this.conversations.getOrderConversation(orderId).subscribe({
      next: (conversation) => {
        this.opened.set(orderId, conversation);
        this.conversation.set(conversation);
        this.isLoading.set(false);

        if (conversation.unreadCount > 0) {
          this.markRead(orderId);
        }
      },
      error: (err: Error) => {
        this.isLoading.set(false);
        if (!silent) {
          this.error.set(err.message);
        }
      },
    });
  }

  private markRead(orderId: string): void {
    this.inbox.markOrderRead(orderId);
    this.conversations.markRead(orderId).subscribe({ error: () => undefined });
  }
}
