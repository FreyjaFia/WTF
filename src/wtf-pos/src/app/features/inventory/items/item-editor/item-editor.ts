import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, InventoryService, ModalStackService } from '@core/services';
import { IconComponent } from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';
import { INVENTORY_UNIT_OPTIONS } from '@shared/constants/inventory-units';

@Component({
  selector: 'app-item-editor',
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './item-editor.html',
  host: { class: 'block h-full' },
})
export class ItemEditorComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly modalStack = inject(ModalStackService);

  protected readonly isEditMode = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly itemName = signal('');
  protected readonly lastUpdatedAt = signal<string | null>(null);
  protected readonly unitOptions = INVENTORY_UNIT_OPTIONS;
  protected readonly showDiscardModal = signal(false);

  protected readonly inventoryForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    sku: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(50)],
    }),
    barcode: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(100)],
    }),
    unitName: new FormControl('piece', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(30)],
    }),
    stockUnitName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(30)],
    }),
    unitsPerStockUnit: new FormControl<number | null>(null, [Validators.min(0.001)]),
    startingQuantity: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.min(0)],
    }),
    costPrice: new FormControl<number | null>(null, [Validators.min(0)]),
    warningQuantity: new FormControl<number | null>(null, [Validators.min(0)]),
    criticalQuantity: new FormControl<number | null>(null, [Validators.min(0)]),
    isActive: new FormControl(true, { nonNullable: true }),
  });

  private inventoryItemId: string | null = null;
  private skipGuard = false;
  private modalStackId: number | null = null;
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;

  public ngOnInit(): void {
    this.setupStockUnitBehavior();

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.syncUnitsPerStockUnitState();
      return;
    }

    this.isEditMode.set(true);
    this.inventoryItemId = id;
    this.inventoryForm.controls.startingQuantity.disable();
    this.loadInventoryItem(id);
  }

  protected saveInventoryItem(): void {
    if (this.inventoryForm.invalid || this.isSaving()) {
      this.inventoryForm.markAllAsTouched();
      return;
    }

    const value = this.inventoryForm.getRawValue();
    this.isSaving.set(true);

    if (this.isEditMode() && this.inventoryItemId) {
      this.inventoryService
        .updateInventoryItem({
          id: this.inventoryItemId,
          name: value.name,
          sku: value.sku || null,
          barcode: value.barcode || null,
          unitName: value.unitName,
          stockUnitName: value.stockUnitName || null,
          unitsPerStockUnit: value.unitsPerStockUnit,
          costPrice: value.costPrice,
          warningQuantity: value.warningQuantity,
          criticalQuantity: value.criticalQuantity,
          isActive: value.isActive,
        })
        .subscribe({
          next: (item) => this.afterSave('Inventory item updated.', item.id),
          error: (err) => this.handleSaveError(err),
        });
      return;
    }

    this.inventoryService
      .createInventoryItem({
        name: value.name,
        sku: value.sku || null,
        barcode: value.barcode || null,
        unitName: value.unitName,
        stockUnitName: value.stockUnitName || null,
        unitsPerStockUnit: value.unitsPerStockUnit,
        startingQuantity: Number(value.startingQuantity ?? 0),
        costPrice: value.costPrice,
        warningQuantity: value.warningQuantity,
        criticalQuantity: value.criticalQuantity,
        isActive: value.isActive,
      })
      .subscribe({
        next: (item) => this.afterSave('Inventory item created.', item.id),
        error: (err) => this.handleSaveError(err),
      });
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.inventoryForm.dirty) {
      return true;
    }

    this.showDiscardModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDiscard());

    return new Promise<boolean>((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected goBack(): void {
    if (this.isEditMode() && this.inventoryItemId) {
      this.router.navigateByUrl(AppRoutes.InventoryItemDetailsById(this.inventoryItemId));
    } else {
      this.router.navigateByUrl(AppRoutes.InventoryItems);
    }
  }

  protected confirmDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(true);
      this.pendingDeactivateResolve = null;
    }
  }

  protected cancelDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(false);
      this.pendingDeactivateResolve = null;
    }
  }

  protected hasError(controlName: string): boolean {
    const control = this.inventoryForm.get(controlName);
    return !!control && control.invalid && control.touched;
  }

  protected getErrorMessage(controlName: string): string | null {
    const control = this.inventoryForm.get(controlName);

    if (!control || !control.errors || !control.touched) {
      return null;
    }

    if (control.errors['required']) {
      return `${this.getFieldLabel(controlName)} is required`;
    }

    if (control.errors['maxlength']) {
      return `${this.getFieldLabel(controlName)} cannot exceed ${control.errors['maxlength'].requiredLength} characters`;
    }

    if (control.errors['min']) {
      return `${this.getFieldLabel(controlName)} must be at least ${control.errors['min'].min}`;
    }

    return null;
  }

  private loadInventoryItem(id: string): void {
    this.isLoading.set(true);
    this.inventoryService.getInventoryItem(id).subscribe({
      next: (item) => {
        this.inventoryForm.patchValue(
          {
            name: item.name,
            sku: item.sku ?? '',
            barcode: item.barcode ?? '',
            unitName: item.unitName,
            stockUnitName: item.stockUnitName ?? '',
            unitsPerStockUnit: item.unitsPerStockUnit ?? null,
            startingQuantity: 0,
            costPrice: item.costPrice ?? null,
            warningQuantity: item.warningQuantity ?? null,
            criticalQuantity: item.criticalQuantity ?? null,
            isActive: item.isActive,
          },
          { emitEvent: false },
        );
        this.itemName.set(item.name);
        this.lastUpdatedAt.set(item.updatedAt || item.createdAt);
        this.syncUnitsPerStockUnitState();
        this.inventoryForm.markAsPristine();
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  private afterSave(message: string, itemId: string): void {
    this.isSaving.set(false);
    this.skipGuard = true;
    this.alertService.success(message);
    this.router.navigateByUrl(AppRoutes.InventoryItemDetailsById(itemId));
  }

  private handleSaveError(err: Error): void {
    this.isSaving.set(false);
    this.alertService.error(err.message);
  }

  private setupStockUnitBehavior(): void {
    this.inventoryForm.controls.unitName.valueChanges.subscribe(() => {
      this.syncUnitsPerStockUnitState();
    });

    this.inventoryForm.controls.stockUnitName.valueChanges.subscribe(() => {
      this.syncUnitsPerStockUnitState();
    });
  }

  private syncUnitsPerStockUnitState(): void {
    const baseUnit = this.inventoryForm.controls.unitName.value;
    const stockUnit = this.inventoryForm.controls.stockUnitName.value;
    const unitsPerStockUnit = this.inventoryForm.controls.unitsPerStockUnit;
    const usesBaseUnit = !stockUnit || stockUnit === baseUnit;

    if (usesBaseUnit) {
      if (stockUnit === baseUnit) {
        this.inventoryForm.controls.stockUnitName.setValue('', { emitEvent: false });
      }
      unitsPerStockUnit.reset(null, { emitEvent: false });
      unitsPerStockUnit.disable({ emitEvent: false });
      return;
    }

    unitsPerStockUnit.enable({ emitEvent: false });
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  private getFieldLabel(controlName: string): string {
    const labels: Record<string, string> = {
      name: 'Name',
      sku: 'SKU',
      barcode: 'Barcode',
      unitName: 'Unit',
      stockUnitName: 'Stock unit',
      unitsPerStockUnit: 'Units per stock unit',
      startingQuantity: 'Starting stock',
      costPrice: 'Cost price',
      warningQuantity: 'Warning level',
      criticalQuantity: 'Critical level',
    };

    return labels[controlName] || controlName;
  }
}
