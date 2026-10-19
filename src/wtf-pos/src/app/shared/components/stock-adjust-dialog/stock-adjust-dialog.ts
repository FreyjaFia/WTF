import { Component, computed, effect, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { adjustmentDelta } from '@shared/calculations';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { AdjustItemStockDto, ItemDto, STOCK_ADJUSTMENT_REASONS } from '@shared/models';

type AdjustMode = 'count' | 'change';

@Component({
  selector: 'app-stock-adjust-dialog',
  imports: [ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './stock-adjust-dialog.html',
  host: { class: 'contents' },
})
export class StockAdjustDialogComponent {
  public readonly item = input.required<ItemDto>();
  public readonly isBusy = input(false);

  public readonly confirmed = output<AdjustItemStockDto>();
  public readonly cancelled = output<void>();

  protected readonly reasons = STOCK_ADJUSTMENT_REASONS;
  protected readonly mode = signal<AdjustMode>('count');
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    quantity: new FormControl<number | null>(null),
    reason: new FormControl<string>(STOCK_ADJUSTMENT_REASONS[0], { nonNullable: true }),
    notes: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly quantity = toSignal(this.form.controls.quantity.valueChanges, {
    initialValue: null,
  });

  protected readonly unit = computed(() => getInventoryUnitAbbreviation(this.item().unitName));

  protected readonly difference = computed<number | null>(() => {
    const quantity = this.quantity();
    if (quantity === null || quantity === undefined || Number.isNaN(quantity)) {
      return null;
    }

    return this.mode() === 'count' ? adjustmentDelta(this.item().currentQuantity, quantity) : quantity;
  });

  private readonly resetErrorOnEdit = effect(() => {
    this.difference();
    this.error.set(null);
  });

  protected setMode(mode: AdjustMode): void {
    this.mode.set(mode);
    this.form.controls.quantity.reset(null);
  }

  protected submit(): void {
    if (this.isBusy()) {
      return;
    }

    const quantity = this.form.controls.quantity.value;
    const difference = this.difference();
    const { reason, notes } = this.form.getRawValue();

    if (quantity === null || difference === null) {
      this.error.set(
        this.mode() === 'count' ? 'Enter the quantity you counted.' : 'Enter how much to add or remove.',
      );
      return;
    }

    if (difference === 0) {
      this.error.set('The count matches the balance, so there is nothing to adjust.');
      return;
    }

    if (reason === 'Other' && !notes.trim()) {
      this.error.set('A note is required when the reason is Other.');
      return;
    }

    this.confirmed.emit({
      itemId: this.item().id,
      countedQuantity: this.mode() === 'count' ? quantity : null,
      expectedQuantity: this.mode() === 'count' ? this.item().currentQuantity : null,
      quantityChange: this.mode() === 'change' ? quantity : null,
      reason,
      notes: notes.trim() || null,
    });
  }
}
