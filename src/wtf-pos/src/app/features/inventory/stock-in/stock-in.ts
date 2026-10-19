import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, InventoryService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { ItemDto } from '@shared/models';

@Component({
  selector: 'app-stock-in',
  imports: [ReactiveFormsModule],
  templateUrl: './stock-in.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockInComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly items = signal<ItemDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);

  protected readonly form = new FormGroup({
    itemId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    quantity: new FormControl<number | null>(null, [Validators.required, Validators.min(0.001)]),
    unitCost: new FormControl<number | null>(null, [Validators.min(0)]),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  public ngOnInit(): void {
    const preselected = this.route.snapshot.queryParamMap.get('itemId');
    this.isLoading.set(true);
    this.inventoryService.getInventoryItems({ isActive: true }).subscribe({
      next: (items) => {
        this.items.set(items);
        if (preselected && items.some((item) => item.id === preselected)) {
          this.form.controls.itemId.setValue(preselected);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected selectedItem(): ItemDto | undefined {
    return this.items().find((item) => item.id === this.form.controls.itemId.value);
  }

  protected unitLabel(): string {
    const item = this.selectedItem();
    return item ? getInventoryUnitAbbreviation(item.unitName) : '';
  }

  protected save(): void {
    if (this.isSaving()) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.isSaving.set(true);
    this.inventoryService
      .addStock({
        itemId: value.itemId,
        quantity: Number(value.quantity),
        unitCost: value.unitCost,
        notes: value.notes.trim() || null,
      })
      .subscribe({
        next: (item) => {
          this.isSaving.set(false);
          this.alertService.success('Stock added.');
          this.router.navigateByUrl(AppRoutes.InventoryItemDetailsById(item.id));
        },
        error: (err) => {
          this.isSaving.set(false);
          this.alertService.error(err.message);
        },
      });
  }
}
