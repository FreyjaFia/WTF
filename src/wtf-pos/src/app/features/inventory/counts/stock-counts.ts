import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, StockCountService } from '@core/services';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
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

@Component({
  selector: 'app-stock-counts',
  imports: [BadgeComponent, DatePipe, ReactiveFormsModule, RouterLink],
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
  protected readonly isStarting = signal(false);
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

  protected load(): void {
    this.isLoading.set(true);
    this.stockCounts.getCounts().subscribe({
      next: (counts) => {
        this.counts.set(counts);
        this.isLoading.set(false);
      },
      error: (err: Error) => {
        this.isLoading.set(false);
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
