import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorMessages } from '@core/messages';
import {
  AlertService,
  AuthService,
  BranchService,
  InventoryService,
  ListStateService,
  StockTransferService,
} from '@core/services';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, isPageSizeOption } from '@shared/calculations/pagination';
import { ConnectionErrorComponent, IconComponent, PullToRefreshComponent } from '@shared/components';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { ItemDto, StockTransferSummaryDto } from '@shared/models';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';
import { Subscription } from 'rxjs';

type TransferSortColumn = 'from' | 'to' | 'items' | 'created';

@Component({
  selector: 'app-stock-transfers',
  imports: [
    ConnectionErrorComponent,
    DatePipe,
    DecimalPipe,
    IconComponent,
    PaginationComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    SortHeaderComponent,
  ],
  templateUrl: './stock-transfers.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockTransfersComponent implements OnInit {
  private readonly transfers = inject(StockTransferService);
  private readonly inventory = inject(InventoryService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly listState = inject(ListStateService);
  protected readonly auth = inject(AuthService);
  protected readonly branchService = inject(BranchService);

  protected readonly rows = signal<StockTransferSummaryDto[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly page = signal(readPageParam(inject(ActivatedRoute)));
  protected readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly sortColumn = signal<TransferSortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly isLoading = signal(false);
  protected readonly isReloading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isFormOpen = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly items = signal<ItemDto[]>([]);
  protected readonly destinations = computed(() =>
    this.branchService.branches().filter((b) => b.isActive && b.id !== this.branchService.activeId()),
  );
  protected readonly canMove = computed(
    () => this.auth.canWriteStockMovements() && !this.branchService.isAllSelected() && this.destinations().length > 0,
  );
  protected readonly form = new FormGroup({
    toBranchId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    lines: new FormArray<FormGroup<{ itemId: FormControl<string>; quantity: FormControl<number | null> }>>([]),
  });

  private loadRequest: Subscription | null = null;

  public ngOnInit(): void {
    const saved = this.listState.load<{ pageSize?: number }>('inventory:stock-transfers', {});
    this.pageSize.set(isPageSizeOption(saved.pageSize) ? (saved.pageSize as number) : DEFAULT_PAGE_SIZE);
    this.load();
  }

  protected get lines(): FormArray<FormGroup<{ itemId: FormControl<string>; quantity: FormControl<number | null> }>> {
    return this.form.controls.lines;
  }

  protected unitOf(itemId: string): string {
    return this.items().find((i) => i.id === itemId)?.unitName ?? '';
  }

  protected availableOf(itemId: string): number | null {
    return this.items().find((i) => i.id === itemId)?.currentQuantity ?? null;
  }

  protected openForm(): void {
    this.isFormOpen.set(true);
    if (this.lines.length === 0) {
      this.addLine();
    }

    this.inventory.getInventoryItems({ isActive: true }).subscribe({
      next: (items) => this.items.set(items),
      error: (err: Error) => this.alertService.error(err.message),
    });
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
    this.form.reset();
    this.lines.clear();
  }

  protected addLine(): void {
    this.lines.push(
      new FormGroup({
        itemId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
        quantity: new FormControl<number | null>(null, [Validators.required, Validators.min(0.001)]),
      }),
    );
  }

  protected removeLine(index: number): void {
    if (this.lines.length > 1) {
      this.lines.removeAt(index);
    }
  }

  protected toggleSort(column: TransferSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }

    this.reloadFromFirstPage();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    writePageParam(this.router, this.activatedRoute, page);
    this.load();
  }

  protected changePageSize(size: number): void {
    this.pageSize.set(size);
    this.listState.save('inventory:stock-transfers', { pageSize: size });
    this.reloadFromFirstPage();
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isSaving()) {
      return;
    }

    const value = this.form.getRawValue();
    this.isSaving.set(true);
    this.transfers
      .createTransfer({
        toBranchId: value.toBranchId,
        notes: value.notes.trim() || null,
        lines: value.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity ?? 0 })),
      })
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.alertService.success('Stock moved.');
          this.closeForm();
          this.reloadFromFirstPage();
        },
        error: (err: Error) => {
          this.isSaving.set(false);
          this.alertService.error(err.message);
        },
      });
  }

  private reloadFromFirstPage(): void {
    this.page.set(1);
    writePageParam(this.router, this.activatedRoute, 1);
    this.load();
  }

  private load(): void {
    const firstLoad = this.rows().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.connectionFailed.set(false);
    this.loadRequest?.unsubscribe();

    this.loadRequest = this.transfers
      .getTransfersPaged({
        sortBy: this.sortColumn(),
        sortDirection: this.sortColumn() ? this.sortDirection() : null,
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set([...result.items]);
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
}
