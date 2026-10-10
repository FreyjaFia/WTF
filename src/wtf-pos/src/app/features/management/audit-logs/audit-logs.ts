import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  AlertService,
  AuditLogService,
  FileDownloadService,
  ListStateService,
} from '@core/services';
import {
  IconComponent,
  PullToRefreshComponent,
  SideDrawerComponent,
  type FilterOption,
} from '@shared/components';
import { AuditLogDto, AuditLogQuery } from '@shared/models';
import { Observable } from 'rxjs';

interface AuditLogListState {
  selectedActions: string[];
  selectedDateRanges: string[];
  customStartDate: string;
  customEndDate: string;
}

@Component({
  selector: 'app-audit-logs',
  imports: [CommonModule, IconComponent, PullToRefreshComponent, SideDrawerComponent],
  templateUrl: './audit-logs.html',
  host: { class: 'flex-1 min-h-0' },
})
export class AuditLogsComponent implements OnInit {
  private readonly auditLogService = inject(AuditLogService);
  private readonly alertService = inject(AlertService);
  private readonly fileDownload = inject(FileDownloadService);
  private readonly listState = inject(ListStateService);
  private readonly stateKey = 'management:audit-logs';

  protected readonly logs = signal<AuditLogDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isDownloadingExcel = signal(false);
  protected readonly isDownloadingPdf = signal(false);
  protected readonly isFiltersOpen = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';

  protected readonly availableActions = signal<string[]>([]);
  protected readonly selectedActions = signal<string[]>([]);
  protected readonly selectedDateRanges = signal<string[]>([]);
  protected readonly customStartDate = signal('');
  protected readonly customEndDate = signal('');
  protected readonly maxDate = (() => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offsetMs).toISOString().split('T')[0];
  })();

  protected readonly dateRangeOptions = computed<FilterOption[]>(() => [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 days' },
    { id: '30d', label: 'Last 30 days' },
    { id: 'custom', label: 'Custom Range' },
  ]);

  protected readonly activeFilterCount = computed(() => {
    const hasDate = this.buildDateRange() !== null ? 1 : 0;
    return hasDate + (this.selectedActions().length > 0 ? 1 : 0);
  });

  public ngOnInit(): void {
    this.restoreState();
    this.loadActions();
    this.loadLogs();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadLogs();
  }

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected isDateRangeSelected(rangeId: string): boolean {
    return this.selectedDateRanges()[0] === rangeId;
  }

  protected toggleDateRangeSelection(rangeId: string): void {
    if (this.selectedDateRanges()[0] === rangeId) {
      this.selectedDateRanges.set([]);
    } else {
      this.selectedDateRanges.set([rangeId]);
    }
    if (rangeId !== 'custom') {
      this.customStartDate.set('');
      this.customEndDate.set('');
    }
    this.filtersChanged();
  }

  protected clearDateRangeSelections(): void {
    this.selectedDateRanges.set([]);
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.filtersChanged();
  }

  protected onCustomStartDateChanged(value: string): void {
    this.customStartDate.set(value);
    this.selectedDateRanges.set(['custom']);
    this.filtersChanged();
  }

  protected onCustomEndDateChanged(value: string): void {
    this.customEndDate.set(value);
    this.selectedDateRanges.set(['custom']);
    this.filtersChanged();
  }

  protected clearCustomDateRange(): void {
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.filtersChanged();
  }

  protected isActionSelected(action: string): boolean {
    return this.selectedActions().includes(action);
  }

  protected toggleActionSelection(action: string): void {
    const current = this.selectedActions();
    if (current.includes(action)) {
      this.selectedActions.set(current.filter((item) => item !== action));
    } else {
      this.selectedActions.set([...current, action]);
    }
    this.filtersChanged();
  }

  protected clearActionSelections(): void {
    this.selectedActions.set([]);
    this.filtersChanged();
  }

  protected downloadExcel(): void {
    this.download(
      this.isDownloadingExcel,
      this.auditLogService.downloadAuditLogsExcel(this.buildQuery()),
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  protected downloadPdf(): void {
    this.download(
      this.isDownloadingPdf,
      this.auditLogService.downloadAuditLogsPdf(this.buildQuery()),
      'pdf',
      'application/pdf',
    );
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

  private filtersChanged(): void {
    this.saveState();
    this.loadLogs();
  }

  private download(
    busy: ReturnType<typeof signal<boolean>>,
    request: Observable<Blob>,
    extension: string,
    contentType: string,
  ): void {
    if (this.isDownloadingExcel() || this.isDownloadingPdf()) {
      return;
    }

    busy.set(true);
    request.subscribe({
      next: (blob) => {
        void this.fileDownload
          .saveBlob(blob, this.buildExportFileName(extension), contentType, 'audit-logs')
          .finally(() => busy.set(false));
      },
      error: (err) => {
        this.alertService.error(err.message);
        busy.set(false);
      },
    });
  }

  /** Same naming as the server: WTF-Audit-Logs-{from}-{to} or the current date. */
  private buildExportFileName(extension: string): string {
    const range = this.buildDateRange();
    const day = (iso: string): string => iso.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    if (range?.fromDate && range.toDate) {
      return `WTF-Audit-Logs-${day(range.fromDate)}-${day(range.toDate)}.${extension}`;
    }
    if (range?.fromDate) {
      return `WTF-Audit-Logs-${day(range.fromDate)}-${today}.${extension}`;
    }
    return `WTF-Audit-Logs-${today}.${extension}`;
  }

  /** Date presets as UTC instants: today = local midnight, 7d/30d = now minus N days, custom = whole days. */
  private buildDateRange(): { fromDate: string; toDate?: string } | null {
    const selected = this.selectedDateRanges()[0];
    if (!selected) {
      return null;
    }

    const start = new Date();
    if (selected === 'today') {
      start.setHours(0, 0, 0, 0);
      return { fromDate: start.toISOString() };
    }
    if (selected === '7d') {
      start.setDate(start.getDate() - 7);
      return { fromDate: start.toISOString() };
    }
    if (selected === '30d') {
      start.setDate(start.getDate() - 30);
      return { fromDate: start.toISOString() };
    }

    const from = this.customStartDate();
    const to = this.customEndDate();
    if (selected === 'custom' && from && to) {
      return {
        fromDate: new Date(`${from}T00:00:00`).toISOString(),
        toDate: new Date(`${to}T23:59:59.999`).toISOString(),
      };
    }

    return null;
  }

  private buildQuery(): AuditLogQuery {
    const query: AuditLogQuery = { ...this.buildDateRange() };
    const actions = this.selectedActions();
    if (actions.length > 0) {
      query.actions = actions;
    }
    return query;
  }

  private loadActions(): void {
    this.auditLogService.getAuditActions().subscribe({
      next: (actions) => this.availableActions.set(actions),
      error: (err) => this.alertService.error(err.message),
    });
  }

  private loadLogs(): void {
    this.isLoading.set(true);

    this.auditLogService.getAuditLogs(this.buildQuery()).subscribe({
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

  private restoreState(): void {
    const state = this.listState.load<AuditLogListState>(this.stateKey, {
      selectedActions: [],
      selectedDateRanges: [],
      customStartDate: '',
      customEndDate: '',
    });

    this.selectedActions.set(state.selectedActions ?? []);
    this.selectedDateRanges.set(state.selectedDateRanges ?? []);
    this.customStartDate.set(state.customStartDate ?? '');
    this.customEndDate.set(state.customEndDate ?? '');
  }

  private saveState(): void {
    this.listState.save<AuditLogListState>(this.stateKey, {
      selectedActions: this.selectedActions(),
      selectedDateRanges: this.selectedDateRanges(),
      customStartDate: this.customStartDate(),
      customEndDate: this.customEndDate(),
    });
  }
}
