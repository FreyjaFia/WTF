import { Injectable, OnDestroy } from '@angular/core';
import { environment } from '@environments/environment.development';
import * as signalR from '@microsoft/signalr';
import { Observable, Subject } from 'rxjs';

const HUB_PATH = '/hubs/customer-orders';
/** Waits before trying to connect again after the first attempt fails (a restart, a bad network); the last repeats. */
const START_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];

const HUB_EVENTS = {
  orderMessage: 'OrderMessageReceived',
  conversationRead: 'ConversationRead',
  orderStatusChanged: 'OrderStatusChanged',
  linkRevoked: 'LinkRevoked',
} as const;

export interface ChatEvent {
  conversationId: string;
  orderId: string;
}

/**
 * Real time for the customer's ordering page. The server only tells the page that something happened (a new message,
 * an order that changed, a revoked link); the page then asks for the data again over the normal routes. The ordering
 * link token is the only credential, sent as the connection's access token, and nothing is ever sent back through
 * the connection. If it drops, the page's own refresh keeps working, so the connection is a convenience.
 */
@Injectable({ providedIn: 'root' })
export class PublicOrderHubService implements OnDestroy {
  private connection: signalR.HubConnection | null = null;
  private connectedToken: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly orderMessage$ = new Subject<ChatEvent>();
  private readonly conversationRead$ = new Subject<ChatEvent>();
  private readonly orderStatusChanged$ = new Subject<string>();
  private readonly linkRevoked$ = new Subject<void>();

  /** A message arrived on one of my orders (mine from another tab included). */
  public get orderMessage(): Observable<ChatEvent> {
    return this.orderMessage$.asObservable();
  }

  /** A chat was read, maybe on another of my open pages, so its unread count changed. */
  public get conversationRead(): Observable<ChatEvent> {
    return this.conversationRead$.asObservable();
  }

  /** One of my orders changed: accepted, rejected, ready or finished. */
  public get orderStatusChanged(): Observable<string> {
    return this.orderStatusChanged$.asObservable();
  }

  /** The link I opened this page with was revoked or switched off. */
  public get linkRevoked(): Observable<void> {
    return this.linkRevoked$.asObservable();
  }

  public connect(token: string): void {
    if (this.connection && this.connectedToken === token) {
      return;
    }

    this.disconnect();

    const hubUrl = environment.apiUrl.replace('/api', HUB_PATH);
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, { accessTokenFactory: () => token })
      .withAutomaticReconnect()
      .build();
    this.connection = connection;
    this.connectedToken = token;

    connection.on(HUB_EVENTS.orderMessage, (conversationId: string, orderId: string) =>
      this.orderMessage$.next({ conversationId, orderId }),
    );
    connection.on(HUB_EVENTS.conversationRead, (conversationId: string, orderId: string) =>
      this.conversationRead$.next({ conversationId, orderId }),
    );
    connection.on(HUB_EVENTS.orderStatusChanged, (orderId: string) => {
      if (orderId) {
        this.orderStatusChanged$.next(orderId);
      }
    });
    connection.on(HUB_EVENTS.linkRevoked, () => {
      this.linkRevoked$.next();
      this.disconnect();
    });

    this.start(connection, 0);
  }

  /**
   * Starts the connection and, if that fails, tries again later while this is still the current connection. The
   * built-in automatic reconnect only covers a connection that was up, so without this a failed first attempt would
   * leave the page without live updates until it is reloaded. A link the server refuses as invalid is also retried, but
   * the page learns that from its own requests and stops the connection.
   */
  private start(connection: signalR.HubConnection, attempt: number): void {
    connection.start().catch((err) => {
      console.error('Customer orders hub connection error:', err);
      if (this.connection !== connection) {
        return;
      }

      const delay = START_RETRY_DELAYS_MS[Math.min(attempt, START_RETRY_DELAYS_MS.length - 1)];
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.connection === connection) {
          this.start(connection, attempt + 1);
        }
      }, delay);
    });
  }

  public disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const connection = this.connection;
    this.connection = null;
    this.connectedToken = null;

    connection?.stop().catch((err) => {
      console.error('Error stopping the customer orders hub:', err);
    });
  }

  public ngOnDestroy(): void {
    this.disconnect();
    this.orderMessage$.complete();
    this.conversationRead$.complete();
    this.orderStatusChanged$.complete();
    this.linkRevoked$.complete();
  }
}
