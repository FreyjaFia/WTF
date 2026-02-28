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
