import { HttpErrorMessages } from '@core/messages';
import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, StockCountService } from '@core/services';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
import { ConnectionErrorComponent, IconComponent, PullToRefreshComponent } from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  STOCK_COUNT_STATUS_LABELS,
  StockCountStatus,
  StockCountSummaryDto,
} from '@shared/models';

const STATUS_VARIANTS: Record<StockCountStatus, BadgeVariant> = {
  [StockCountStatus.Open]: 'amber',
  [StockCountStatus.Posted]: 'success',
  [StockCountStatus.Cancelled]: 'default',
};

const STATUS_BARS: Record<StockCountStatus, string> = {
  [StockCountStatus.Open]: 'bg-amber-400',
  [StockCountStatus.Posted]: 'bg-green-500',
  [StockCountStatus.Cancelled]: 'bg-gray-300',
};

@Component({
  selector: 'app-stock-counts',
  imports: [ConnectionErrorComponent, 
    BadgeComponent,
    DatePipe,
    IconComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './stock-counts.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockCountsComponent implements OnInit {
  private readonly stockCounts = inject(StockCountService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly counts = signal<StockCountSummaryDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isStarting = signal(false);
  protected readonly isFormOpen = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly statusLabels = STOCK_COUNT_STATUS_LABELS;
  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    isBlind: new FormControl(false, { nonNullable: true }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  public ngOnInit(): void {
    this.load();
  }

  protected countRoute(id: string): string {
    return AppRoutes.InventoryCountById(id);
  }

  protected variantOf(status: StockCountStatus): BadgeVariant {
    return STATUS_VARIANTS[status];
  }

  protected statusBar(status: StockCountStatus): string {
    return STATUS_BARS[status];
  }

  protected openForm(): void {
    this.isFormOpen.set(true);
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
    this.form.reset();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected load(): void {
    this.connectionFailed.set(false);
    this.isLoading.set(true);
    this.stockCounts.getCounts().subscribe({
      next: (counts) => {
        this.counts.set(counts);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected start(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isStarting()) {
      return;
    }

    const value = this.form.getRawValue();
    this.isStarting.set(true);
    this.stockCounts
      .startCount({
        name: value.name.trim(),
        isBlind: value.isBlind,
        note: value.note.trim() || null,
        itemIds: null,
      })
      .subscribe({
        next: (count) => {
          this.isStarting.set(false);
          void this.router.navigateByUrl(AppRoutes.InventoryCountById(count.summary.id));
        },
        error: (err: Error) => {
          this.isStarting.set(false);
          this.alertService.error(err.message);
        },
      });
  }
}
