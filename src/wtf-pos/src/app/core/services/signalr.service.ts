import { inject, Injectable, OnDestroy } from '@angular/core';
import { AuthService } from '@core/services';
import { environment } from '@environments/environment.development';
import * as signalR from '@microsoft/signalr';
import { Observable, Subject } from 'rxjs';

const HUB_PATHS = {
  dashboard: '/hubs/dashboard',
} as const;

const HUB_EVENTS = {
  dashboardUpdated: 'DashboardUpdated',
  orderUpdated: 'OrderUpdated',
} as const;

@Injectable({ providedIn: 'root' })
export class SignalRService implements OnDestroy {
  private readonly authService = inject(AuthService);

  private hubConnection: signalR.HubConnection | null = null;
  private readonly dashboardUpdated$ = new Subject<void>();
  private readonly orderUpdated$ = new Subject<string>();
  private hubUsageCount = 0;

  public get dashboardUpdated(): Observable<void> {
    return this.dashboardUpdated$.asObservable();
  }

  public get orderUpdated(): Observable<string> {
    return this.orderUpdated$.asObservable();
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
    this.dashboardUpdated$.complete();
    this.orderUpdated$.complete();
  }
}
