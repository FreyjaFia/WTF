import { inject, Injectable, OnDestroy } from '@angular/core';
import { AuthService } from '@core/services';
import { environment } from '@environments/environment.development';
import * as signalR from '@microsoft/signalr';
import { Observable, Subject } from 'rxjs';

/** Waits before trying to connect again after a failed first attempt; the last one repeats. */
const STAFF_START_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];

const HUB_PATHS = {
  dashboard: '/hubs/dashboard',
  staffOrders: '/hubs/staff-orders',
  notifications: '/hubs/notifications',
} as const;

const HUB_EVENTS = {
  dashboardUpdated: 'DashboardUpdated',
  orderUpdated: 'OrderUpdated',
  orderMessage: 'OrderMessageReceived',
  conversationRead: 'ConversationRead',
  orderStatusChanged: 'OrderStatusChanged',
  notificationsChanged: 'NotificationsChanged',
  stockChanged: 'StockChanged',
} as const;

/** A chat changed: a message arrived, or someone opened it. */
export interface ChatChange {
  conversationId: string;
  orderId: string;
}

@Injectable({ providedIn: 'root' })
export class SignalRService implements OnDestroy {
  private readonly authService = inject(AuthService);

  private hubConnection: signalR.HubConnection | null = null;
  private readonly dashboardUpdated$ = new Subject<void>();
  private readonly orderUpdated$ = new Subject<string>();
  private hubUsageCount = 0;

  private staffConnection: signalR.HubConnection | null = null;
  private staffUsageCount = 0;
  private staffRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly orderMessage$ = new Subject<ChatChange>();
  private readonly conversationRead$ = new Subject<ChatChange>();
  private readonly orderChanged$ = new Subject<string>();

  private notificationsConnection: signalR.HubConnection | null = null;
  private notificationsUsageCount = 0;
  private notificationsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly notificationsChanged$ = new Subject<void>();
  private readonly stockChanged$ = new Subject<string>();

  public get dashboardUpdated(): Observable<void> {
    return this.dashboardUpdated$.asObservable();
  }

  public get orderUpdated(): Observable<string> {
    return this.orderUpdated$.asObservable();
  }

  /** A customer wrote to the shop, or the shop wrote back. Staff who can read orders hear this. */
  public get orderMessage(): Observable<ChatChange> {
    return this.orderMessage$.asObservable();
  }

  /** A chat was opened by someone, so its unread count changed for everyone. */
  public get conversationRead(): Observable<ChatChange> {
    return this.conversationRead$.asObservable();
  }

  /** An order changed (accepted, ready, paid, cancelled, edited...), so an open screen of it can reload. */
  public get orderChanged(): Observable<string> {
    return this.orderChanged$.asObservable();
  }

  /** The signed-in person's notifications changed (new, lifted or read on another device). Ask the API for the counts. */
  public get notificationsChanged(): Observable<void> {
    return this.notificationsChanged$.asObservable();
  }

  /** An item's stock changed (a sale, stock-in, count...). Only people who look after stock hear this. */
  public get stockChanged(): Observable<string> {
    return this.stockChanged$.asObservable();
  }

  /**
   * Starts listening for chat changes. This is a separate connection from the dashboard one on purpose: cashiers answer
   * customers but may not open the dashboard, so the dashboard hub would refuse them.
   */
  public startStaffOrdersHub(): void {
    this.staffUsageCount += 1;
    if (this.staffConnection) {
      return;
    }

    const hubUrl = environment.apiUrl.replace('/api', HUB_PATHS.staffOrders);
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        // Read at every (re)connect, so a refreshed sign-in token is used.
        accessTokenFactory: () => this.authService.getToken() ?? '',
      })
      .withAutomaticReconnect()
      .build();
    this.staffConnection = connection;

    connection.on(HUB_EVENTS.orderMessage, (conversationId: string, orderId: string) => {
      this.orderMessage$.next({ conversationId, orderId });
    });
    connection.on(HUB_EVENTS.conversationRead, (conversationId: string, orderId: string) => {
      this.conversationRead$.next({ conversationId, orderId });
    });

    connection.on(HUB_EVENTS.orderStatusChanged, (orderId: string) => {
      if (orderId) {
        this.orderChanged$.next(orderId);
      }
    });

    this.startStaff(connection, 0);
  }

  /** Retries a failed first connection, which the built-in automatic reconnect does not cover. */
  private startStaff(connection: signalR.HubConnection, attempt: number): void {
    connection.start().catch((err) => {
      console.error('Staff orders SignalR hub connection error:', err);

      if (this.staffConnection !== connection) {
        return;
      }

      const delay = STAFF_START_RETRY_DELAYS_MS[Math.min(attempt, STAFF_START_RETRY_DELAYS_MS.length - 1)];
      this.staffRetryTimer = setTimeout(() => {
        this.staffRetryTimer = null;
        if (this.staffConnection === connection) {
          this.startStaff(connection, attempt + 1);
        }
      }, delay);
    });
  }

  public stopStaffOrdersHub(): void {
    if (this.staffUsageCount > 0) {
      this.staffUsageCount -= 1;
    }
    if (this.staffUsageCount > 0 || !this.staffConnection) {
      return;
    }

    if (this.staffRetryTimer) {
      clearTimeout(this.staffRetryTimer);
      this.staffRetryTimer = null;
    }
    this.staffConnection.stop().catch((err) => {
      console.error('Error stopping staff orders hub:', err);
    });
    this.staffConnection = null;
  }

  /**
   * Starts the personal connection: every signed-in person gets "your notifications changed", and people who look after
   * stock also get "stock changed". It only says that something changed; the screen then asks the API.
   */
  public startNotificationsHub(): void {
    this.notificationsUsageCount += 1;
    if (this.notificationsConnection) {
      return;
    }

    const hubUrl = environment.apiUrl.replace('/api', HUB_PATHS.notifications);
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => this.authService.getToken() ?? '',
      })
      .withAutomaticReconnect()
      .build();
    this.notificationsConnection = connection;

    connection.on(HUB_EVENTS.notificationsChanged, () => {
      this.notificationsChanged$.next();
    });
    connection.on(HUB_EVENTS.stockChanged, (itemId: string) => {
      this.stockChanged$.next(itemId);
    });
    // After a dropped connection comes back, anything could have changed meanwhile.
    connection.onreconnected(() => {
      this.notificationsChanged$.next();
      this.stockChanged$.next('');
    });

    this.startNotifications(connection, 0);
  }

  private startNotifications(connection: signalR.HubConnection, attempt: number): void {
    connection.start().catch((err) => {
      console.error('Notifications SignalR hub connection error:', err);

      if (this.notificationsConnection !== connection) {
        return;
      }

      const delay = STAFF_START_RETRY_DELAYS_MS[Math.min(attempt, STAFF_START_RETRY_DELAYS_MS.length - 1)];
      this.notificationsRetryTimer = setTimeout(() => {
        this.notificationsRetryTimer = null;
        if (this.notificationsConnection === connection) {
          this.startNotifications(connection, attempt + 1);
        }
      }, delay);
    });
  }

  public stopNotificationsHub(): void {
    if (this.notificationsUsageCount > 0) {
      this.notificationsUsageCount -= 1;
    }
    if (this.notificationsUsageCount > 0 || !this.notificationsConnection) {
      return;
    }

    if (this.notificationsRetryTimer) {
      clearTimeout(this.notificationsRetryTimer);
      this.notificationsRetryTimer = null;
    }
    this.notificationsConnection.stop().catch((err) => {
      console.error('Error stopping notifications hub:', err);
    });
    this.notificationsConnection = null;
  }

  public startDashboardHub(): void {
    this.hubUsageCount += 1;
    if (this.hubConnection) {
      return;
    }

    const hubUrl = environment.apiUrl.replace('/api', HUB_PATHS.dashboard);
    const token = this.authService.getToken();

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => token ?? '',
      })
      .withAutomaticReconnect()
      .build();
    this.hubConnection = connection;

    connection.on(HUB_EVENTS.dashboardUpdated, () => {
      this.dashboardUpdated$.next();
    });
    connection.on(HUB_EVENTS.orderUpdated, (orderId: string) => {
      if (orderId) {
        this.orderUpdated$.next(orderId);
      }
    });

    connection.start().catch((err) => {
      console.error('Dashboard SignalR hub connection error:', err);

      // Drop the dead connection so the next start reconnects, unless it was already replaced.
      if (this.hubConnection === connection) {
        this.hubConnection = null;
      }
    });
  }

  public stopDashboardHub(): void {
    if (this.hubUsageCount > 0) {
      this.hubUsageCount -= 1;
    }
    if (this.hubUsageCount > 0) {
      return;
    }

    if (!this.hubConnection) {
      return;
    }

    this.hubConnection.stop().catch((err) => {
      console.error('Error stopping dashboard hub:', err);
    });
    this.hubConnection = null;
  }

  public ngOnDestroy(): void {
    this.stopDashboardHub();
    this.staffUsageCount = 1;
    this.stopStaffOrdersHub();
    this.notificationsUsageCount = 1;
    this.stopNotificationsHub();
    this.dashboardUpdated$.complete();
    this.orderUpdated$.complete();
    this.orderMessage$.complete();
    this.conversationRead$.complete();
    this.orderChanged$.complete();
    this.notificationsChanged$.complete();
    this.stockChanged$.complete();
  }
}
