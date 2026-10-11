import { Component, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { ConversationInboxService, ConversationService, ModalStackService, SignalRService } from '@core/services';
import { ChatComponent } from '@shared/components/chat/chat';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { OrderConversationDto } from '@shared/models';
import { Subscription } from 'rxjs';

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
    this.conversations.sendMessage(id, body).subscribe({
      next: (message) => {
        this.conversation.update((current) =>
          current && !current.messages.some((m) => m.id === message.id)
            ? { ...current, messages: [...current.messages, message] }
            : current,
        );
        this.draft.set('');
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
    this.conversation.set(null);
    this.error.set(null);
    this.draft.set('');
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

  private load(orderId: string, silent: boolean): void {
    if (!silent) {
      this.isLoading.set(true);
    }

    this.conversations.getOrderConversation(orderId).subscribe({
      next: (conversation) => {
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
