import { Component, computed, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { WasteReasonService } from '@core/services/waste-reason.service';
import { wasteBalanceAfter, wasteNeedsReview } from '@shared/calculations';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { RecordStockWasteDto, StockWasteSource, WasteReasonDto } from '@shared/models';

const MAX_QUANTITY = 999999.999;

export interface WasteItem {
  id: string;
  name: string;
  unitName: string;
  currentQuantity: number;
  allowNegativeStock: boolean;
  wasteApprovalLimit?: number | null;
}

@Component({
  selector: 'app-record-waste-dialog',
  imports: [ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './record-waste-dialog.html',
  host: { class: 'contents' },
})
export class RecordWasteDialogComponent implements OnInit {
  private readonly wasteReasonService = inject(WasteReasonService);

  public readonly item = input.required<WasteItem>();
  public readonly isBusy = input(false);
  public readonly source = input<StockWasteSource>(StockWasteSource.ItemDetails);

  public readonly confirmed = output<RecordStockWasteDto>();
  public readonly cancelled = output<void>();

  protected readonly reasons = signal<WasteReasonDto[]>([]);
  protected readonly isLoadingReasons = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    quantity: new FormControl<number | null>(null),
    reasonId: new FormControl<string>('', { nonNullable: true }),
    notes: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly quantity = toSignal(this.form.controls.quantity.valueChanges, {
    initialValue: null,
  });
  private readonly reasonId = toSignal(this.form.controls.reasonId.valueChanges, {
    initialValue: '',
  });

  // One id per form: a retry after a failed or timed-out request sends the same id, so the API saves it once.
  private readonly clientRequestId = crypto.randomUUID();

  protected readonly unit = computed(() => getInventoryUnitAbbreviation(this.item().unitName));

  protected readonly selectedReason = computed<WasteReasonDto | null>(() => {
    const id = Number(this.reasonId());
    return this.reasons().find((reason) => reason.id === id) ?? null;
  });

  protected readonly validQuantity = computed<number | null>(() => {
    const quantity = this.quantity();
    if (quantity === null || quantity === undefined || Number.isNaN(quantity) || quantity <= 0) {
      return null;
    }

    return quantity;
  });

  protected readonly balanceAfter = computed<number | null>(() => {
    const quantity = this.validQuantity();
    return quantity === null ? null : wasteBalanceAfter(this.item().currentQuantity, quantity);
  });

  protected readonly needsReview = computed(() => {
    const quantity = this.validQuantity();
    return quantity !== null && wasteNeedsReview(quantity, this.item().wasteApprovalLimit);
  });

  protected readonly goesBelowZero = computed(() => {
    const after = this.balanceAfter();
    return after !== null && after < 0;
  });

  protected readonly isBlocked = computed(() => this.goesBelowZero() && !this.item().allowNegativeStock);

  private readonly resetErrorOnEdit = effect(() => {
    this.quantity();
    this.reasonId();
    this.error.set(null);
  });

  public ngOnInit(): void {
    this.wasteReasonService.getReasons().subscribe({
      next: (reasons) => {
        this.reasons.set(
          reasons
            .filter((reason) => reason.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        );
        this.isLoadingReasons.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.isLoadingReasons.set(false);
      },
    });
  }

  protected submit(): void {
    if (this.isBusy()) {
      return;
    }

    const quantity = this.validQuantity();
    const reason = this.selectedReason();
    const notes = this.form.controls.notes.value.trim();

    if (quantity === null) {
      this.error.set('Enter how much was wasted.');
      return;
    }

    if (quantity > MAX_QUANTITY) {
      this.error.set('The quantity is too large.');
      return;
    }

    if (!reason) {
      this.error.set('Choose a reason.');
      return;
    }

    if (reason.requiresNote && !notes) {
      this.error.set(`A note is required when the reason is ${reason.name}.`);
      return;
    }

    if (this.isBlocked()) {
      this.error.set(
        `${this.item().name} does not allow sales below zero, so it cannot waste more than its balance.`,
      );
      return;
    }

    this.confirmed.emit({
      itemId: this.item().id,
      quantity,
      wasteReasonId: reason.id,
      notes: notes || null,
      source: this.source(),
      clientRequestId: this.clientRequestId,
    });
  }
}
