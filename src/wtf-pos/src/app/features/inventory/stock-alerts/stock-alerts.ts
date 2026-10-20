import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertService, StockAlertService } from '@core/services';
import { BadgeComponent } from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';
import { StockAlertLevel, StockNotificationDto } from '@shared/models';

const PAGE_SIZE = 25;

@Component({
  selector: 'app-stock-alerts',
  imports: [DatePipe, BadgeComponent],
  templateUrl: './stock-alerts.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockAlertsComponent implements OnInit {
  private readonly stockAlerts = inject(StockAlertService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);

  protected readonly notifications = signal<StockNotificationDto[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly isLoading = signal(false);
  protected readonly isMarking = signal(false);
  protected readonly unread = this.stockAlerts.unread;
  protected readonly canLoadMore = computed(() => this.notifications().length < this.totalCount());

  public ngOnInit(): void {
    this.load(true);
  }

  protected load(reset: boolean): void {
    const page = reset ? 1 : Math.floor(this.notifications().length / PAGE_SIZE) + 1;
    this.isLoading.set(true);
    this.stockAlerts.list({ page, pageSize: PAGE_SIZE }).subscribe({
      next: (result) => {
        this.notifications.set(reset ? result.items : [...this.notifications(), ...result.items]);
        this.totalCount.set(result.totalCount);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected markAllRead(): void {
    if (this.isMarking() || this.unread() === 0) {
      return;
    }

    this.isMarking.set(true);
    this.stockAlerts.markRead().subscribe({
      next: () => {
        this.notifications.update((items) => items.map((item) => ({ ...item, isRead: true })));
        this.isMarking.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isMarking.set(false);
      },
    });
  }

  protected open(notification: StockNotificationDto): void {
    if (!notification.isRead) {
      this.stockAlerts.markRead([notification.id]).subscribe({ error: () => undefined });
      this.notifications.update((items) =>
        items.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)),
      );
    }

    this.router.navigateByUrl(AppRoutes.InventoryItemDetailsById(notification.itemId));
  }

  protected badgeVariant(status: StockAlertLevel): 'warning' | 'error' {
    return status === 'Warning' ? 'warning' : 'error';
  }

  protected levelLabel(status: StockAlertLevel): string {
    switch (status) {
      case 'Warning':
        return 'Low';
      case 'Critical':
        return 'Critical';
      default:
        return 'Out';
    }
  }
}
