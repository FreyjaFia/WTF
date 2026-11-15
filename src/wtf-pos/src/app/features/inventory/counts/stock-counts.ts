import { HttpErrorMessages } from '@core/messages';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, ListStateService, StockCountService } from '@core/services';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
import { ConnectionErrorComponent, IconComponent, PullToRefreshComponent } from '@shared/components';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  STOCK_COUNT_STATUS_LABELS,
  StockCountStatus,
  StockCountSummaryDto,
} from '@shared/models';
import { debounceTime, Subscription } from 'rxjs';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, isPageSizeOption } from '@shared/calculations/pagination';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';

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
  imports: [PaginationComponent, ConnectionErrorComponent, 
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
  protected readonly totalCount = signal(0);
  protected readonly page = signal(readPageParam(inject(ActivatedRoute)));
  protected readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly isReloading = signal(false);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly listState = inject(ListStateService);
  private loadRequest: Subscription | null = null;
  protected readonly sortColumn = signal<CountSortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');
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
    const saved = this.listState.load<{ pageSize?: number }>('inventory:stock-counts', {});
    this.pageSize.set(isPageSizeOption(saved.pageSize) ? (saved.pageSize as number) : DEFAULT_PAGE_SIZE);
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

    this.reloadFromFirstPage();
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
    const firstLoad = this.counts().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.connectionFailed.set(false);
    this.loadRequest?.unsubscribe();

    this.loadRequest = this.stockCounts
      .getCountsPaged({

        sortBy: this.sortColumn(),
        sortDirection: this.sortColumn() ? this.sortDirection() : null,
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.counts.set([...result.items]);
          this.totalCount.set(result.totalCount);
          if (result.page !== this.page()) {
            this.page.set(result.page);
            writePageParam(this.router, this.activatedRoute, result.page);
          }
          this.isLoading.set(false);
          this.isReloading.set(false);
          this.isRefreshing.set(false);
        },
        error: (err: Error) => {
          this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
          this.isLoading.set(false);
          this.isReloading.set(false);
          this.isRefreshing.set(false);
          this.alertService.error(err.message);
        },
      });
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    writePageParam(this.router, this.activatedRoute, page);
    this.load();
  }

  protected changePageSize(size: number): void {
    this.pageSize.set(size);
    this.listState.save('inventory:stock-counts', { pageSize: size });
    this.reloadFromFirstPage();
  }

  protected reloadFromFirstPage(): void {
    this.page.set(1);
    writePageParam(this.router, this.activatedRoute, 1);
    this.load();
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
