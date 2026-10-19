import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, InventoryService, ModalStackService } from '@core/services';
import {
  BadgeComponent,
  IconComponent,
  PriceHistoryDrawerComponent,
  StockAdjustDialogComponent,
} from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import {
  AdjustItemStockDto,
  ItemDto,
  ItemPriceHistoryDto,
  StockMovementDto,
} from '@shared/models';

type StockStatus = 'ok' | 'warning' | 'critical';

const MOVEMENT_PAGE_SIZE = 25;

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  AddStock: 'Stock in',
  Sale: 'Sale',
  SaleVoid: 'Sale returned',
  Waste: 'Waste',
  Adjustment: 'Adjustment',
};

@Component({
  selector: 'app-item-details',
  imports: [
    CommonModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    PriceHistoryDrawerComponent,
    ConfirmDialogComponent,
    StockAdjustDialogComponent,
  ],
  templateUrl: './item-details.html',
  host: { class: 'block h-full' },
})
export class ItemDetailsComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  protected readonly routes = AppRoutes;

  protected readonly item = signal<ItemDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly isHistoryOpen = signal(false);
  protected readonly priceHistory = signal<ItemPriceHistoryDto[]>([]);
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
  protected readonly showRestoreModal = signal(false);
  protected readonly isRestoring = signal(false);
  protected readonly movements = signal<StockMovementDto[]>([]);
  protected readonly movementsTotal = signal(0);
  protected readonly movementType = signal<string>('');
  protected readonly isLoadingMovements = signal(false);
  protected readonly showAdjustModal = signal(false);
  protected readonly isAdjusting = signal(false);
  protected readonly movementTypes = Object.keys(MOVEMENT_TYPE_LABELS);
  private modalStackId: number | null = null;

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadItem(id);
    }
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

  protected restoreItem(): void {
    if (!this.canWriteItems()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (!this.item()) {
      return;
    }

    this.showRestoreModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelRestore());
  }

  protected cancelRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    this.showRestoreModal.set(false);
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

    const item = this.item();
    if (!item) {
      return;
    }

    this.isRestoring.set(true);
    this.inventoryService.restoreInventoryItem(item.id).subscribe({
      next: () => {
        this.isRestoring.set(false);
        this.showRestoreModal.set(false);
        this.removeFromStack();
        this.alertService.successRestored('Item');
        this.loadItem(item.id);
      },
      error: (err) => {
        this.isRestoring.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected deleteItem(): void {
    if (!this.canWriteItems()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (!this.item()) {
      return;
    }

    this.showDeleteModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDelete());
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.removeFromStack();
  }

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canWriteItems()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const item = this.item();
    if (!item) {
      return;
    }

    this.isDeleting.set(true);
    this.inventoryService.deleteInventoryItem(item.id).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.removeFromStack();
        this.alertService.successDeleted('Item');
        this.router.navigateByUrl(AppRoutes.InventoryItems);
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(
          err.message || this.alertService.getDeleteErrorMessage('item'),
        );
      },
    });
  }

  protected canWriteItems(): boolean {
    return this.authService.canWriteItems();
  }

  protected canReadStock(): boolean {
    return this.authService.canReadStockMovements();
  }

  protected canWriteStock(): boolean {
    return this.authService.canWriteStockMovements();
  }

  protected movementLabel(type: string): string {
    return MOVEMENT_TYPE_LABELS[type] ?? type;
  }

  protected filterMovements(type: string): void {
    this.movementType.set(type);
    this.loadMovements(true);
  }

  protected loadMoreMovements(): void {
    this.loadMovements(false);
  }

  protected adjustStock(): void {
    if (!this.canWriteStock()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.showAdjustModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelAdjust());
  }

  protected cancelAdjust(): void {
    if (this.isAdjusting()) {
      return;
    }

    this.showAdjustModal.set(false);
    this.removeFromStack();
  }

  protected confirmAdjust(payload: AdjustItemStockDto): void {
    if (this.isAdjusting()) {
      return;
    }

    this.isAdjusting.set(true);
    this.inventoryService.adjustStock(payload).subscribe({
      next: (item) => {
        this.isAdjusting.set(false);
        this.showAdjustModal.set(false);
        this.removeFromStack();
        this.item.set(item);
        this.alertService.success('Stock adjusted.');
        this.loadMovements(true);
      },
      error: (err) => {
        this.isAdjusting.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected openPriceHistory(): void {
    this.isHistoryOpen.set(true);
  }

  protected closePriceHistory(): void {
    this.isHistoryOpen.set(false);
  }

  private loadItem(id: string): void {
    this.isLoading.set(true);
    this.inventoryService.getInventoryItem(id).subscribe({
      next: (item) => {
        this.item.set(item);
        this.priceHistory.set(item.priceHistory || []);
        this.isLoading.set(false);
        this.loadMovements(true);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  private loadMovements(reset: boolean): void {
    const item = this.item();
    if (!item || !this.canReadStock()) {
      return;
    }

    const page = reset ? 1 : Math.floor(this.movements().length / MOVEMENT_PAGE_SIZE) + 1;
    this.isLoadingMovements.set(true);
    this.inventoryService
      .getItemMovements(item.id, {
        type: this.movementType() || null,
        page,
        pageSize: MOVEMENT_PAGE_SIZE,
      })
      .subscribe({
        next: (result) => {
          this.movements.set(reset ? result.items : [...this.movements(), ...result.items]);
          this.movementsTotal.set(result.totalCount);
          this.isLoadingMovements.set(false);
        },
        error: (err) => {
          this.alertService.error(err.message);
          this.isLoadingMovements.set(false);
        },
      });
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
