import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
  BadgeComponent,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  SideDrawerComponent,
} from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { InventoryItemDto } from '@shared/models';
import { debounceTime } from 'rxjs';

type StockStatus = 'ok' | 'warning' | 'critical';

interface ItemListState {
  searchTerm: string;
  selectedStatuses: StockStatus[];
}

@Component({
  selector: 'app-item-list',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
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
  protected readonly routes = AppRoutes;

  protected readonly items = signal<InventoryItemDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly isFiltersOpen = signal(false);
  protected readonly selectedStatuses = signal<StockStatus[]>(['ok', 'warning', 'critical']);
  protected readonly showDeleteModal = signal(false);
  protected readonly itemToDelete = signal<InventoryItemDto | null>(null);
  protected readonly isDeleting = signal(false);
  private modalStackId: number | null = null;

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly statusCounts = computed(() => {
    const items = this.items();
    return {
      ok: items.filter((item) => this.getStockStatus(item) === 'ok').length,
      warning: items.filter((item) => this.getStockStatus(item) === 'warning').length,
      critical: items.filter((item) => this.getStockStatus(item) === 'critical').length,
    };
  });

  protected readonly statusOptions = computed<FilterOption[]>(() => [
    { id: 'ok', label: 'OK', count: this.statusCounts().ok },
    { id: 'warning', label: 'Warning', count: this.statusCounts().warning },
    { id: 'critical', label: 'Critical', count: this.statusCounts().critical },
  ]);

  protected readonly filteredItems = computed(() => {
    const search = (this.filterForm.controls.searchTerm.value ?? '').trim().toLowerCase();
    const selectedStatuses = this.selectedStatuses();
    let items = [...this.items()];

    if (selectedStatuses.length > 0) {
      items = items.filter((item) => selectedStatuses.includes(this.getStockStatus(item)));
    }

    if (!search) {
      return items;
    }

    return items.filter((item) =>
      [item.name, item.sku, item.barcode]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(search)),
    );
  });

  public ngOnInit(): void {
    this.restoreState();
    this.loadInventory();

    this.filterForm.valueChanges.pipe(debounceTime(200)).subscribe(() => {
      this.saveState();
    });
  }

  protected loadInventory(): void {
    this.isLoading.set(true);
    this.inventoryService.getInventoryItems({ includeInactive: true }).subscribe({
      next: (items) => {
        this.items.set(items);
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

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadInventory();
  }

  protected navigateToDetails(itemId: string): void {
    this.router.navigateByUrl(AppRoutes.InventoryItemDetailsById(itemId));
  }

  protected navigateToStockIn(): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.router.navigateByUrl(AppRoutes.InventoryStockIn);
  }

  protected deleteItem(item: InventoryItemDto): void {
    if (!this.canWriteManagement()) {
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

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canWriteManagement()) {
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

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected getStockStatus(item: InventoryItemDto): StockStatus {
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

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }

  protected getStockQuantity(item: InventoryItemDto): number {
    if (item.stockUnitName && item.unitsPerStockUnit && item.unitsPerStockUnit > 0) {
      return item.currentQuantity / item.unitsPerStockUnit;
    }

    return item.currentQuantity;
  }

  protected getStockUnitAbbreviation(item: InventoryItemDto): string {
    return getInventoryUnitAbbreviation(item.stockUnitName || item.unitName);
  }

  protected getBaseUnitAbbreviation(item: InventoryItemDto): string {
    return getInventoryUnitAbbreviation(item.unitName);
  }

  protected shouldShowBaseQuantity(item: InventoryItemDto): boolean {
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
  }

  protected clearStatusSelections(): void {
    this.selectedStatuses.set([]);
    this.saveState();
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
  }

  private saveState(): void {
    this.listState.save<ItemListState>(this.stateKey, {
      searchTerm: this.filterForm.controls.searchTerm.value ?? '',
      selectedStatuses: this.selectedStatuses(),
    });
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
