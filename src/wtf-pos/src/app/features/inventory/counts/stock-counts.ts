import { HttpErrorMessages } from '@core/messages';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, StockCountService } from '@core/services';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
import { ConnectionErrorComponent, IconComponent, PullToRefreshComponent } from '@shared/components';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
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

type CountSortColumn = 'count' | 'created' | 'progress' | 'status';

@Component({
  selector: 'app-stock-counts',
  imports: [ConnectionErrorComponent, 
    BadgeComponent,
    DatePipe,
    IconComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    RouterLink,
    SortHeaderComponent,
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
  protected readonly sortColumn = signal<CountSortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly sortedCounts = computed(() => {
    const column = this.sortColumn();
    const counts = [...this.counts()];
    if (!column) {
      return counts;
    }

    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const progress = (c: StockCountSummaryDto): number => (c.lineCount === 0 ? 0 : c.countedCount / c.lineCount);
    const compare = (a: StockCountSummaryDto, b: StockCountSummaryDto): number => {
      switch (column) {
        case 'count':
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        case 'created':
          return a.createdAt.localeCompare(b.createdAt);
        case 'progress':
          return progress(a) - progress(b);
        case 'status':
          return a.status - b.status;
      }
    };

    return counts.sort((a, b) => compare(a, b) * direction);
  });
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

  protected toggleSort(column: CountSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
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
