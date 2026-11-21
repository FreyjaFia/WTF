import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AlertService,
  AuthService,
  BranchService,
  InventoryService,
  ModalStackService,
  StockWasteService,
} from '@core/services';
import {
  BadgeComponent,
  IconComponent,
  PageTitleComponent,
  PriceHistoryDrawerComponent,
  RecordWasteDialogComponent,
  StockAdjustDialogComponent,
  WasteItem,
} from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { ItemBranchSettingsComponent } from './item-branch-settings';
import { AppRoutes } from '@shared/constants/app-routes';
import { readPageParam, writePageParam } from '@shared/utils/list-page-url';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import {
  AdjustItemStockDto,
  ItemDto,
  ItemPriceHistoryDto,
  RecordStockWasteDto,
  StockMovementDto,
} from '@shared/models';

type StockStatus = 'ok' | 'warning' | 'critical';


const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  AddStock: 'Stock in',
  Sale: 'Sale',
  SaleVoid: 'Sale returned',
  Waste: 'Waste',
  WasteReversed: 'Waste reversed',
  Adjustment: 'Adjustment',
};

@Component({
  selector: 'app-item-details',
  imports: [PaginationComponent, 
    CommonModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    PageTitleComponent,
    PriceHistoryDrawerComponent,
    ConfirmDialogComponent,
    StockAdjustDialogComponent,
    RecordWasteDialogComponent,
    ItemBranchSettingsComponent,
  ],
  templateUrl: './item-details.html',
  host: { class: 'block h-full' },
})
export class ItemDetailsComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  protected readonly branchService = inject(BranchService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly stockWasteService = inject(StockWasteService);
  protected readonly routes = AppRoutes;
  protected readonly backLink: string = this.resolveBackLink();

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
  protected readonly movementPage = signal(readPageParam(this.route));
  protected readonly movementPageSize = signal(25);
  protected readonly showAdjustModal = signal(false);
  protected readonly isAdjusting = signal(false);
  protected readonly showWasteModal = signal(false);
  protected readonly isRecordingWaste = signal(false);
  protected readonly wasteItem = computed<WasteItem | null>(() => {
    const item = this.item();
    if (!item) {
      return null;
    }

    return {
      id: item.id,
      name: item.name,
      unitName: item.unitName,
      currentQuantity: item.currentQuantity,
      allowNegativeStock: item.allowNegativeStock,
      wasteApprovalLimit: item.wasteApprovalLimit ?? null,
    };
  });
  protected readonly movementTypes = Object.keys(MOVEMENT_TYPE_LABELS);
  protected readonly activeProductLinks = computed(() =>
    (this.item()?.productLinks ?? []).filter((link) => link.isActive),
  );
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

  protected canRecordWaste(): boolean {
    return this.authService.canWriteStockWaste();
  }

  protected hasWasteableStock(item: ItemDto): boolean {
    return item.currentQuantity > 0;
  }

  protected recordWaste(): void {
    if (!this.canRecordWaste()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.showWasteModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelWaste());
  }

  protected cancelWaste(): void {
    if (this.isRecordingWaste()) {
      return;
    }

    this.showWasteModal.set(false);
    this.removeFromStack();
  }

  protected confirmWaste(payload: RecordStockWasteDto): void {
    if (this.isRecordingWaste()) {
      return;
    }

    this.isRecordingWaste.set(true);
    this.stockWasteService.recordWaste(payload).subscribe({
      next: (waste) => {
        this.isRecordingWaste.set(false);
        this.showWasteModal.set(false);
        this.removeFromStack();
        this.alertService.success(
          waste.status === 'PendingReview'
            ? 'Waste recorded. It needs Admin review.'
            : 'Waste recorded.',
        );
        this.loadItem(payload.itemId);
      },
      error: (err) => {
        this.isRecordingWaste.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected movementLabel(type: string): string {
    return MOVEMENT_TYPE_LABELS[type] ?? type;
  }

  protected filterMovements(type: string): void {
    this.movementType.set(type);
    this.loadMovements(true);
  }

  protected goToMovementPage(page: number): void {
    this.movementPage.set(page);
    writePageParam(this.router, this.route, page);
    this.loadMovements(false);
  }

  protected changeMovementPageSize(size: number): void {
    this.movementPageSize.set(size);
    this.loadMovements(true);
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

  private resolveBackLink(): string {
    const returnUrl = this.route.snapshot.queryParamMap?.get('returnUrl');
    // Only in-app paths, so a crafted link cannot send the back arrow elsewhere
    if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
      return returnUrl;
    }

    return AppRoutes.InventoryItems;
  }

  protected openPriceHistory(): void {
    this.isHistoryOpen.set(true);
  }

  protected closePriceHistory(): void {
    this.isHistoryOpen.set(false);
  }

  protected loadItem(id: string): void {
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

    if (reset && this.movementPage() !== 1) {
      this.movementPage.set(1);
      writePageParam(this.router, this.route, 1);
    }

    this.isLoadingMovements.set(true);
    this.inventoryService
      .getItemMovements(item.id, {
        type: this.movementType() || null,
        page: this.movementPage(),
        pageSize: this.movementPageSize(),
      })
      .subscribe({
        next: (result) => {
          this.movements.set(result.items);
          if (result.page && result.page !== this.movementPage()) {
            this.movementPage.set(result.page);
            writePageParam(this.router, this.route, result.page);
          }
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
