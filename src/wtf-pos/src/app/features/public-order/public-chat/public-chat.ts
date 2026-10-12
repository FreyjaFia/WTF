import { Component, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { DRAWER_SLIDE_MS } from '@shared/components/drawer-timing';
import { ModalStackService } from '@core/services';
import { PublicLinkInvalidError, PublicOrderService } from '@core/services/public-order.service';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { ChatComponent } from '@shared/components/chat/chat';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ChatImageLoader } from '@shared/components/chat/chat-image';
import { ChatImageSend, ConversationMessageDto, OrderConversationDto } from '@shared/models';
import { Observable, of, Subscription } from 'rxjs';

/**
 * The customer's side of an order's chat: a sheet that rises from the bottom on phones and slides in from the right on
 * wide screens. It asks the shop's server for the chat each time it opens, marks the shop's replies as read, shows new
 * messages as they arrive and sends what the customer writes. Nothing is kept on the device. If the link stops working
 * while it is open, the page is told so it can show the invalid-link page.
 */
@Component({
  selector: 'app-public-chat',
  imports: [ChatComponent, IconComponent],
  templateUrl: './public-chat.html',
})
export class PublicChatComponent implements OnDestroy {
  private readonly service = inject(PublicOrderService);
  private readonly hub = inject(PublicOrderHubService);
  private readonly modalStack = inject(ModalStackService);

  public readonly isOpen = input(false);
  public readonly token = input.required<string>();
  public readonly orderId = input<string | null>(null);
  public readonly orderNumber = input<number | null>(null);

  public readonly closed = output<void>();
  /** Shows a "Go to order" button, for chats opened away from their order. */
  public readonly canGoToOrder = input(false);
  public readonly goToOrder = output<void>();
  /** Unread counts changed (the replies were read), so the page can refresh its badges. */
  public readonly changed = output<void>();
  /** The link stopped working. */
  public readonly linkInvalid = output<void>();

  protected readonly conversation = signal<OrderConversationDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly isSending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly attachment = signal<File | null>(null);

  /** The customer's link is the proof, so a picture is a plain address an image tag can load. */
  protected readonly imageLoader: ChatImageLoader = (message) =>
    of(this.service.messageImageUrl(this.token(), this.orderId() ?? '', message.id));

  protected readonly hasTransitions = signal(false);

  /** The chat body exists while the panel is open and for the length of the slide out, so it never empties while moving. */
  protected readonly contentMounted = signal(false);
  /** The messages are drawn once the panel has finished sliding in, so building them does not stutter the slide. */
  protected readonly contentReady = signal(false);
  private slideTimerId: number | null = null;

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
    this.submit((id) => this.service.sendMessage(this.token(), id, body));
  }

  protected sendImage(upload: ChatImageSend): void {
    this.submit((id) => this.service.sendImageMessage(this.token(), id, upload.file, upload.body));
  }

  /** Takes back a picture I sent. The message stays and says the photo was removed. */
  protected removeImage(message: ConversationMessageDto): void {
    const id = this.orderId();
    if (!id) {
      return;
    }

    this.error.set(null);
    this.service.removeMessageImage(this.token(), id, message.id).subscribe({
      next: (updated) =>
        this.conversation.update((current) =>
          current ? { ...current, messages: current.messages.map((m) => (m.id === updated.id ? updated : m)) } : current,
        ),
      error: (err: Error) => {
        if (err instanceof PublicLinkInvalidError) {
          this.linkInvalid.emit();
          return;
        }

        this.error.set(err.message);
        // The chat may have just closed: show it as it is now.
        this.load(id, true);
      },
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
        this.isSending.set(false);
        if (err instanceof PublicLinkInvalidError) {
          this.linkInvalid.emit();
          return;
        }

        // What was typed stays in the box. The chat may have just closed, so show it as it is now.
        this.error.set(err.message);
        this.load(id, true);
      },
    });
  }

  private begin(orderId: string): void {
    this.showContent();
    this.conversation.set(null);
    this.error.set(null);
    this.draft.set('');
    this.attachment.set(null);
    this.load(orderId, false);

    this.modalStackId ??= this.modalStack.push(() => this.close());
    this.liveSubscription?.unsubscribe();
    this.liveSubscription = this.hub.orderMessage.subscribe((change) => {
      if (change.orderId === orderId) {
        this.load(orderId, true);
      }
    });
  }

  private end(): void {
    this.hideContent();
    this.liveSubscription?.unsubscribe();
    this.liveSubscription = null;

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

    this.service.getOrderConversation(this.token(), orderId).subscribe({
      next: (conversation) => {
        this.conversation.set(conversation);
        this.isLoading.set(false);

        if (conversation.unreadCount > 0) {
          this.service.markConversationRead(this.token(), orderId).subscribe({
            next: () => this.changed.emit(),
            error: () => undefined,
          });
        }
      },
      error: (err: Error) => {
        this.isLoading.set(false);
        if (err instanceof PublicLinkInvalidError) {
          this.linkInvalid.emit();
        } else if (!silent) {
          this.error.set(err.message);
        }
      },
    });
  }
}
