import { Component, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { ModalStackService } from '@core/services';
import { PublicLinkInvalidError, PublicOrderService } from '@core/services/public-order.service';
import { PublicOrderHubService } from '@core/services/public-order-hub.service';
import { ChatComponent } from '@shared/components/chat/chat';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { OrderConversationDto } from '@shared/models';
import { Subscription } from 'rxjs';

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

  protected readonly hasTransitions = signal(false);

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
  }

  protected close(): void {
    this.closed.emit();
  }

  protected title(): string {
    return this.conversation()?.title ?? (this.orderNumber() ? `Order #${this.orderNumber()}` : 'Chat');
  }

  protected send(body: string): void {
    const id = this.orderId();
    if (!id || this.isSending()) {
      return;
    }

    this.isSending.set(true);
    this.error.set(null);
    this.service.sendMessage(this.token(), id, body).subscribe({
      next: (message) => {
        this.conversation.update((current) =>
          current ? { ...current, messages: [...current.messages, message] } : current,
        );
        this.draft.set('');
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
    this.conversation.set(null);
    this.error.set(null);
    this.draft.set('');
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
    this.liveSubscription?.unsubscribe();
    this.liveSubscription = null;

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
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
