import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { ConversationSummaryDto } from '@shared/models';
import { Subscription } from 'rxjs';
import { ConversationService } from './conversation.service';
import { SignalRService } from './signalr.service';

/** A burst of messages is turned into one refresh. */
const REFRESH_DELAY_MS = 300;
/** The live connection is only a convenience, so the list is also refreshed now and then. */
const POLL_MS = 60_000;

/**
 * What the staff envelope shows: the conversations with customers, unread first, and how many are unread. It is shared
 * by the header, the sidebar and the order screens, so they all agree. It listens for chat changes and loads the list
 * again, instead of working the counts out itself, so the numbers always come from the server.
 */
@Injectable({ providedIn: 'root' })
export class ConversationInboxService implements OnDestroy {
  private readonly conversations = inject(ConversationService);
  private readonly signalR = inject(SignalRService);

  private readonly _items = signal<ConversationSummaryDto[]>([]);
  private readonly _unreadConversations = signal(0);
  private readonly _isLoading = signal(false);
  private readonly _failed = signal(false);

  public readonly items = this._items.asReadonly();
  /** What the envelope badge shows. */
  public readonly unreadConversations = this._unreadConversations.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly failed = this._failed.asReadonly();

  private readonly unreadByOrder = computed(() => {
    const map = new Map<string, number>();
    for (const item of this._items()) {
      if (item.orderId && item.unreadCount > 0) {
        map.set(item.orderId, item.unreadCount);
      }
    }
    return map;
  });

  private usage = 0;
  private subscriptions: Subscription[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Messages waiting on one order, for the small badge on its card or button. */
  public unreadFor(orderId: string): number {
    return this.unreadByOrder().get(orderId) ?? 0;
  }

  /** Starts listening. Every screen that shows chat state calls this, and stops when it goes away. */
  public start(): void {
    this.usage += 1;
    if (this.usage > 1) {
      return;
    }

    this.signalR.startStaffOrdersHub();
    this.subscriptions = [
      this.signalR.orderMessage.subscribe(() => this.scheduleRefresh()),
      this.signalR.conversationRead.subscribe(() => this.scheduleRefresh()),
    ];
    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
    this.refresh();
  }

  public stop(): void {
    if (this.usage === 0) {
      return;
    }

    this.usage -= 1;
    if (this.usage > 0) {
      return;
    }

    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.subscriptions = [];
    this.signalR.stopStaffOrdersHub();
    this.clearTimers();
  }

  public refresh(): void {
    this._isLoading.set(true);
    this.conversations.getConversations().subscribe({
      next: (list) => {
        this._items.set(list.items);
        this._unreadConversations.set(list.unreadConversations);
        this._failed.set(false);
        this._isLoading.set(false);
      },
      error: () => {
        // Keep what is already shown: a failed refresh must not make the badge vanish.
        this._failed.set(true);
        this._isLoading.set(false);
      },
    });
  }

  /** Clears one order's unread count at once when staff open its chat, before the server's answer comes back. */
  public markOrderRead(orderId: string): void {
    const current = this._items();
    const target = current.find((item) => item.orderId === orderId);
    if (!target || target.unreadCount === 0) {
      return;
    }

    this._items.set(current.map((item) => (item === target ? { ...item, unreadCount: 0 } : item)));
    this._unreadConversations.update((count) => Math.max(0, count - 1));
  }

  public ngOnDestroy(): void {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.clearTimers();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, REFRESH_DELAY_MS);
  }

  private clearTimers(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
