import { HttpErrorMessages } from '@core/messages';
import { CommonModule } from '@angular/common';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import { selectedFilterCount } from '@shared/utils/filter-count';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  AlertService,
  AuthService,
  InventoryService,
  ListStateService,
  ModalStackService,
} from '@core/services';
import type { FilterOption } from '@shared/components';
import {
  AvatarComponent,
  BadgeComponent,
  IconComponent,
  ConnectionErrorComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  SideDrawerComponent,
} from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { ItemDto } from '@shared/models';
import { debounceTime, Subscription } from 'rxjs';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, isPageSizeOption } from '@shared/calculations/pagination';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';

type StockStatus = 'ok' | 'warning' | 'critical';

interface ItemListState {
  searchTerm: string;
  selectedStatuses: StockStatus[];
  pageSize?: number;
}

type ItemSortColumn = 'name' | 'stock' | 'status' | 'cost';

@Component({
  selector: 'app-item-list',
  imports: [
    SortHeaderComponent,
    FilterButtonComponent,
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    AvatarComponent,
    BadgeComponent,
    ConfirmDialogComponent,
    ConnectionErrorComponent,
    PaginationComponent,
    PullToRefreshComponent,
    SearchInputComponent,
    SideDrawerComponent,
  ],
  templateUrl: './item-list.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ItemListComponent implements OnInit {
  private readonly stateKey = 'inventory:item-list';
  private readonly inventoryService = inject(InventoryService);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly listState = inject(ListStateService);
  private readonly modalStack = inject(ModalStackService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly routes = AppRoutes;

  protected readonly items = signal<ItemDto[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly facets = signal<Record<string, number>>({});
  protected readonly page = signal(readPageParam(this.route));
  protected readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly isReloading = signal(false);
  private loadRequest: Subscription | null = null;
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isFiltersOpen = signal(false);
  protected readonly selectedStatuses = signal<StockStatus[]>(['ok', 'warning', 'critical']);
  protected readonly showDeleteModal = signal(false);
  protected readonly itemToDelete = signal<ItemDto | null>(null);
  protected readonly isDeleting = signal(false);
  protected readonly showRestoreModal = signal(false);
  protected readonly itemToRestore = signal<ItemDto | null>(null);
  protected readonly isRestoring = signal(false);
  private modalStackId: number | null = null;

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'ok', label: 'OK', count: this.facets()['ok'] ?? 0 },
    { id: 'warning', label: 'Warning', count: this.facets()['warning'] ?? 0 },
    { id: 'critical', label: 'Critical', count: this.facets()['critical'] ?? 0 },
  ]);

  protected readonly sortColumn = signal<ItemSortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');

  protected toggleSort(column: ItemSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }

    this.reloadFromFirstPage();
  }

  public ngOnInit(): void {
    this.restoreState();
    this.loadInventory();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.saveState();
      this.reloadFromFirstPage();
    });
  }

  protected loadInventory(): void {
    const firstLoad = this.items().length === 0;
    this.isLoading.set(firstLoad);
    this.isReloading.set(!firstLoad);
    this.connectionFailed.set(false);
    this.loadRequest?.unsubscribe();

    this.loadRequest = this.inventoryService
      .getInventoryItemsPaged({
        searchTerm: this.filterForm.controls.searchTerm.value?.trim() || null,
        stockStatuses: this.selectedStatuses(),
        sortBy: this.sortColumn(),
        sortDirection: this.sortDirection(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.items.set([...result.items]);
          this.totalCount.set(result.totalCount);
          this.facets.set(result.facets ?? {});
          if (result.page !== this.page()) {
            this.page.set(result.page);
            writePageParam(this.router, this.route, result.page);
          }
          this.isLoading.set(false);
          this.isReloading.set(false);
          this.isRefreshing.set(false);
        },
        error: (err) => {
          this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
          this.alertService.error(err.message);
          this.isLoading.set(false);
          this.isReloading.set(false);
          this.isRefreshing.set(false);
        },
      });
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    writePageParam(this.router, this.route, page);
    this.loadInventory();
  }

  protected changePageSize(size: number): void {
    this.pageSize.set(size);
    this.saveState();
    this.reloadFromFirstPage();
  }

  private reloadFromFirstPage(): void {
    this.page.set(1);
    writePageParam(this.router, this.route, 1);
    this.loadInventory();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadInventory();
  }

  protected navigateToDetails(itemId: string): void {
    this.router.navigateByUrl(AppRoutes.InventoryItemDetailsById(itemId));
  }

  protected navigateToStockIn(item?: ItemDto): void {
    if (!this.canWriteStockMovements()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (item) {
      this.router.navigate([AppRoutes.InventoryStockIn], { queryParams: { itemId: item.id } });
      return;
    }

    this.router.navigateByUrl(AppRoutes.InventoryStockIn);
  }

  protected linkedProductCount(item: ItemDto): number {
    return item.productLinks.filter((link) => link.isActive && link.productIsActive !== false).length;
  }

  protected deleteItem(item: ItemDto): void {
    if (!this.canWriteItems()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.itemToDelete.set(item);
    this.showDeleteModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDelete());
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.itemToDelete.set(null);
    this.removeFromStack();
  }

  protected restoreItem(item: ItemDto): void {
    if (!this.canWriteItems()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.itemToRestore.set(item);
    this.showRestoreModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelRestore());
  }

  protected cancelRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    this.showRestoreModal.set(false);
    this.itemToRestore.set(null);
    this.removeFromStack();
  }

  protected confirmRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    if (!this.canWriteItems()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const item = this.itemToRestore();
    if (!item) {
      return;
    }

    this.isRestoring.set(true);
    this.inventoryService.restoreInventoryItem(item.id).subscribe({
      next: () => {
        this.isRestoring.set(false);
        this.showRestoreModal.set(false);
        this.itemToRestore.set(null);
        this.removeFromStack();
        this.alertService.successRestored('Item');
        this.loadInventory();
      },
      error: (err) => {
        this.isRestoring.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canWriteItems()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const item = this.itemToDelete();
    if (!item) {
      return;
    }

    this.isDeleting.set(true);
    this.inventoryService.deleteInventoryItem(item.id).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.itemToDelete.set(null);
        this.removeFromStack();
        this.loadInventory();
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  /** How many filters are applied, shown on the Filters button. */
  protected readonly activeFilterCount = computed(() =>
    selectedFilterCount(this.selectedStatuses().length, this.statusOptions().length),
  );

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected getStockStatus(item: ItemDto): StockStatus {
    if (
      item.criticalQuantity !== null &&
      item.criticalQuantity !== undefined &&
      item.currentQuantity <= item.criticalQuantity
    ) {
      return 'critical';
    }

    if (
      item.warningQuantity !== null &&
      item.warningQuantity !== undefined &&
      item.currentQuantity <= item.warningQuantity
    ) {
      return 'warning';
    }

    return 'ok';
  }

  protected canWriteItems(): boolean {
    return this.authService.canWriteItems();
  }

  protected canWriteStockMovements(): boolean {
    return this.authService.canWriteStockMovements();
  }

  protected getStockQuantity(item: ItemDto): number {
    if (item.stockUnitName && item.unitsPerStockUnit && item.unitsPerStockUnit > 0) {
      return item.currentQuantity / item.unitsPerStockUnit;
    }

    return item.currentQuantity;
  }

  protected getStockUnitAbbreviation(item: ItemDto): string {
    return getInventoryUnitAbbreviation(item.stockUnitName || item.unitName);
  }

  protected getBaseUnitAbbreviation(item: ItemDto): string {
    return getInventoryUnitAbbreviation(item.unitName);
  }

  protected shouldShowBaseQuantity(item: ItemDto): boolean {
    return !!item.stockUnitName && !!item.unitsPerStockUnit && item.unitsPerStockUnit > 0;
  }

  protected isStatusSelected(status: string): boolean {
    return this.selectedStatuses().includes(status as StockStatus);
  }

  protected toggleStatusSelection(status: string): void {
    const stockStatus = status as StockStatus;
    const selected = this.selectedStatuses();
    this.selectedStatuses.set(
      selected.includes(stockStatus)
        ? selected.filter((selectedStatus) => selectedStatus !== stockStatus)
        : [...selected, stockStatus],
    );
    this.saveState();
    this.reloadFromFirstPage();
  }

  protected clearStatusSelections(): void {
    this.selectedStatuses.set([]);
    this.saveState();
    this.reloadFromFirstPage();
  }

  private restoreState(): void {
    const state = this.listState.load<ItemListState>(this.stateKey, {
      searchTerm: '',
      selectedStatuses: ['ok', 'warning', 'critical'],
    });

    this.filterForm.patchValue(
      {
        searchTerm: state.searchTerm,
      },
      { emitEvent: false },
    );
    this.selectedStatuses.set(state.selectedStatuses);
    this.pageSize.set(isPageSizeOption(state.pageSize) ? (state.pageSize as number) : DEFAULT_PAGE_SIZE);
  }

  private saveState(): void {
    this.listState.save<ItemListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedStatuses: this.selectedStatuses(),
      pageSize: this.pageSize(),
    });
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
