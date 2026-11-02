import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, StockCountService } from '@core/services';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  STOCK_COUNT_STATUS_LABELS,
  StockCountDto,
  StockCountEntryDto,
  StockCountStatus,
} from '@shared/models';
import { Observable } from 'rxjs';

const STATUS_VARIANTS: Record<StockCountStatus, BadgeVariant> = {
  [StockCountStatus.Open]: 'amber',
  [StockCountStatus.Posted]: 'success',
  [StockCountStatus.Cancelled]: 'default',
};

@Component({
  selector: 'app-stock-count-sheet',
  imports: [
    BadgeComponent,
    ConfirmDialogComponent,
    DecimalPipe,
    IconComponent,
    ReactiveFormsModule,
    RouterLink,
    SearchInputComponent,
  ],
  templateUrl: './stock-count-sheet.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockCountSheetComponent implements OnInit {
  private readonly stockCounts = inject(StockCountService);
  private readonly alertService = inject(AlertService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly listRoute = AppRoutes.InventoryCounts;
  protected readonly statusLabels = STOCK_COUNT_STATUS_LABELS;
  protected readonly statusVariants = STATUS_VARIANTS;
  protected readonly count = signal<StockCountDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isPosting = signal(false);
  protected readonly isCancelling = signal(false);
  protected readonly confirming = signal<'post' | 'cancel' | null>(null);
  protected readonly search = signal('');
  protected readonly controls = signal<Record<string, FormControl<number | null>>>({});
  protected readonly changeTick = signal(0);
  protected readonly isOpen = computed(
    () =>
      this.count()?.summary.status === StockCountStatus.Open &&
      this.auth.canWriteStockMovements(),
  );
  protected readonly visibleLines = computed(() => {
    const term = this.search().trim().toLowerCase();
    const lines = this.count()?.lines ?? [];
    return term ? lines.filter((line) => line.itemName.toLowerCase().includes(term)) : lines;
  });
  protected readonly countedNow = computed(() => {
    this.changeTick();
    return Object.values(this.controls()).filter((control) => control.value !== null).length;
  });
  protected readonly hasUnsaved = computed(() => {
    this.changeTick();
    return Object.values(this.controls()).some((control) => control.dirty);
  });

  public ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      return;
    }

    this.isLoading.set(true);
    this.stockCounts.getCount(id).subscribe({
      next: (count) => {
        this.apply(count);
        this.isLoading.set(false);
      },
      error: (err: Error) => {
        this.isLoading.set(false);
        this.alertService.error(err.message);
        void this.router.navigateByUrl(AppRoutes.InventoryCounts);
      },
    });
  }

  protected save(): void {
    const current = this.count();
    if (!current || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    this.persist(current).subscribe({
      next: (count) => {
        this.isSaving.set(false);
        this.apply(count);
        this.alertService.success('Counted numbers saved.');
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected askPost(): void {
    if (this.countedNow() === 0) {
      this.alertService.error('Count at least one item before posting.');
      return;
    }

    this.confirming.set('post');
  }

  protected askCancel(): void {
    this.confirming.set('cancel');
  }

  protected closeConfirm(): void {
    this.confirming.set(null);
  }

  protected confirmPost(): void {
    const current = this.count();
    if (!current || this.isPosting()) {
      return;
    }

    this.isPosting.set(true);
    this.persist(current).subscribe({
      next: () =>
        this.stockCounts.postCount(current.summary.id).subscribe({
          next: (count) => {
            this.isPosting.set(false);
            this.confirming.set(null);
            this.apply(count);
            this.alertService.success('Count posted. The balances now match what you counted.');
          },
          error: (err: Error) => {
            this.isPosting.set(false);
            this.confirming.set(null);
            this.alertService.error(err.message);
          },
        }),
      error: (err: Error) => {
        this.isPosting.set(false);
        this.confirming.set(null);
        this.alertService.error(err.message);
      },
    });
  }

  protected confirmCancel(): void {
    const current = this.count();
    if (!current || this.isCancelling()) {
      return;
    }

    this.isCancelling.set(true);
    this.stockCounts.cancelCount(current.summary.id).subscribe({
      next: (count) => {
        this.isCancelling.set(false);
        this.confirming.set(null);
        this.apply(count);
      },
      error: (err: Error) => {
        this.isCancelling.set(false);
        this.confirming.set(null);
        this.alertService.error(err.message);
      },
    });
  }

  protected controlOf(itemId: string): FormControl<number | null> {
    return this.controls()[itemId];
  }

  private persist(current: StockCountDto): Observable<StockCountDto> {
    const entries: StockCountEntryDto[] = Object.entries(this.controls())
      .filter(([, control]) => control.dirty)
      .map(([itemId, control]) => ({ itemId, countedQuantity: control.value }));
    return entries.length > 0
      ? this.stockCounts.saveLines(current.summary.id, entries)
      : this.stockCounts.getCount(current.summary.id);
  }

  private apply(count: StockCountDto): void {
    this.count.set(count);
    const controls: Record<string, FormControl<number | null>> = {};
    for (const line of count.lines) {
      const control = new FormControl<number | null>(line.countedQuantity);
      control.valueChanges.subscribe(() => this.changeTick.update((tick) => tick + 1));
      controls[line.itemId] = control;
    }

    this.controls.set(controls);
    this.changeTick.update((tick) => tick + 1);
  }
}
