import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, InventoryService, ModalStackService } from '@core/services';
import { BadgeComponent, IconComponent } from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { ItemDto } from '@shared/models';

type StockStatus = 'ok' | 'warning' | 'critical';

@Component({
  selector: 'app-item-details',
  imports: [CommonModule, RouterLink, IconComponent, BadgeComponent],
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
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
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

  protected deleteItem(): void {
    if (!this.canWriteManagement()) {
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

    if (!this.canWriteManagement()) {
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

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }

  private loadItem(id: string): void {
    this.isLoading.set(true);
    this.inventoryService.getInventoryItem(id).subscribe({
      next: (item) => {
        this.item.set(item);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
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
