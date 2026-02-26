import { inject, Injectable, OnDestroy } from '@angular/core';
import { AuthService } from '@core/services';
import { environment } from '@environments/environment.development';
import * as signalR from '@microsoft/signalr';
import { Observable, Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SignalRService implements OnDestroy {
  private readonly authService = inject(AuthService);

  private hubConnection: signalR.HubConnection | null = null;
  private readonly dashboardUpdated$ = new Subject<void>();
  private isConnecting = false;

  public get dashboardUpdated(): Observable<void> {
    return this.dashboardUpdated$.asObservable();
  }

  public startDashboardHub(): void {
    if (this.hubConnection || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    const hubUrl = environment.apiUrl.replace('/api', '/hubs/dashboard');
    const token = this.authService.getToken();

    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => token ?? '',
      })
      .withAutomaticReconnect()
      .build();

    this.hubConnection.on('DashboardUpdated', () => {
      this.dashboardUpdated$.next();
    });

    this.hubConnection
      .start()
      .then(() => {
        this.isConnecting = false;
      })
      .catch((err) => {
        this.isConnecting = false;
        console.error('Dashboard SignalR hub connection error:', err);
      });
  }

  public stopDashboardHub(): void {
    if (this.hubConnection) {
      this.hubConnection.stop().catch((err) => {
        console.error('Error stopping dashboard hub:', err);
      });
      this.hubConnection = null;
    }
  }

  public ngOnDestroy(): void {
    this.stopDashboardHub();
    this.dashboardUpdated$.complete();
  }
}
