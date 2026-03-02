import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AlertService, AuditLogService } from '@core/services';
import { IconComponent, PullToRefreshComponent } from '@shared/components';
import { AuditLogDto } from '@shared/models';

@Component({
  selector: 'app-audit-logs',
  imports: [CommonModule, IconComponent, PullToRefreshComponent],
  templateUrl: './audit-logs.html',
  host: { class: 'flex-1 min-h-0' },
})
export class AuditLogsComponent implements OnInit {
  private readonly auditLogService = inject(AuditLogService);
  private readonly alertService = inject(AlertService);

  protected readonly logs = signal<AuditLogDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';

  public ngOnInit(): void {
    this.loadLogs();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadLogs();
  }

  protected formatAuditTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return timestamp;
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);

    const month = parts.find((part) => part.type === 'month')?.value ?? '';
    const day = parts.find((part) => part.type === 'day')?.value ?? '';
    const year = parts.find((part) => part.type === 'year')?.value ?? '';
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
    const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value ?? '';

    return `${month} ${day}, ${year} ${hour}:${minute} ${dayPeriod}`.trim();
  }

  private loadLogs(): void {
    this.isLoading.set(true);

    this.auditLogService.getAuditLogs().subscribe({
      next: (result) => {
        this.logs.set(result.items);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }
}
