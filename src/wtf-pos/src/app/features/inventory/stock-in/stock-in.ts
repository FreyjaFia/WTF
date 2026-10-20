import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AlertService, InventoryService, StockAttentionService } from '@core/services';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { ItemDto } from '@shared/models';

interface RecentEntry {
  itemId: string;
  name: string;
  added: number;
  unit: string;
  balanceAfter: number;
}

type ItemLevel = 'ok' | 'low' | 'critical' | 'out';

const SMALL_UNIT_PRESETS = [100, 500, 1000, 5000];
const PIECE_PRESETS = [1, 5, 10, 50];
const SMALL_UNITS = new Set(['ml', 'g']);
const MAX_RECENT = 5;
const LEVEL_ORDER: Record<ItemLevel, number> = { out: 0, critical: 1, low: 2, ok: 3 };

@Component({
  selector: 'app-stock-in',
  imports: [ReactiveFormsModule, RouterLink, SearchInputComponent],
  templateUrl: './stock-in.html',
  host: { class: 'flex-1 min-h-0' },
})
export class StockInComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  private readonly alertService = inject(AlertService);
  private readonly route = inject(ActivatedRoute);
  private readonly attention = inject(StockAttentionService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<ItemDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly recent = signal<RecentEntry[]>([]);
  protected readonly search = signal('');

  protected readonly form = new FormGroup({
    itemId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    quantity: new FormControl<number | null>(null, [Validators.required, Validators.min(0.001)]),
    unitCost: new FormControl<number | null>(null, [Validators.min(0)]),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  private readonly itemId = toSignal(this.form.controls.itemId.valueChanges, { initialValue: '' });
  private readonly quantity = toSignal(this.form.controls.quantity.valueChanges, { initialValue: null });

  /** The items to choose from: the ones that need stock first, then by name; the search narrows them. */
  protected readonly choices = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.items()
      .filter(
        (item) =>
          !term ||
          item.name.toLowerCase().includes(term) ||
          (item.sku ?? '').toLowerCase().includes(term) ||
          (item.barcode ?? '').toLowerCase().includes(term),
      )
      .sort(
        (a, b) =>
          LEVEL_ORDER[this.levelOf(a)] - LEVEL_ORDER[this.levelOf(b)] || a.name.localeCompare(b.name),
      );
  });
  protected readonly selected = computed(() => this.items().find((item) => item.id === this.itemId()));
  protected readonly unit = computed(() => {
    const item = this.selected();
    return item ? getInventoryUnitAbbreviation(item.unitName) : '';
  });
  protected readonly presets = computed(() => (SMALL_UNITS.has(this.unit()) ? SMALL_UNIT_PRESETS : PIECE_PRESETS));
  protected readonly receiving = computed(() => {
    const quantity = Number(this.quantity());
    return quantity > 0 ? quantity : 0;
  });
  protected readonly balanceAfter = computed(() => {
    const item = this.selected();
    return item && this.receiving() > 0 ? item.currentQuantity + this.receiving() : null;
  });
  protected readonly itemRoute = AppRoutes.InventoryItemDetailsById;

  public ngOnInit(): void {
    this.attention.start();
    this.destroyRef.onDestroy(() => this.attention.stop());
    this.form.controls.itemId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.form.controls.quantity.reset(null);
    });

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

  protected levelOf(item: ItemDto): ItemLevel {
    if (item.currentQuantity <= 0) {
      return 'out';
    }
    if (item.criticalQuantity != null && item.currentQuantity <= item.criticalQuantity) {
      return 'critical';
    }
    if (item.warningQuantity != null && item.currentQuantity <= item.warningQuantity) {
      return 'low';
    }
    return 'ok';
  }

  protected unitOf(item: ItemDto): string {
    return getInventoryUnitAbbreviation(item.unitName);
  }

  protected setSearch(value: string): void {
    this.search.set(value);
  }

  protected pick(itemId: string): void {
    this.form.controls.itemId.setValue(itemId);
    this.form.controls.itemId.markAsDirty();
  }

  protected addPreset(amount: number): void {
    const current = Number(this.form.controls.quantity.value) || 0;
    this.form.controls.quantity.setValue(current + amount);
    this.form.controls.quantity.markAsDirty();
  }

  protected format(quantity: number): string {
    return Number(quantity.toFixed(3)).toLocaleString('en-US');
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
    const item = this.selected();
    this.isSaving.set(true);
    this.inventoryService
      .addStock({
        itemId: value.itemId,
        quantity: Number(value.quantity),
        unitCost: value.unitCost,
        notes: value.notes.trim() || null,
      })
      .subscribe({
        next: (updated) => {
          this.isSaving.set(false);
          this.alertService.success('Stock added.');
          this.items.update((list) => list.map((entry) => (entry.id === updated.id ? updated : entry)));
          this.recent.update((list) =>
            [
              {
                itemId: updated.id,
                name: item?.name ?? updated.name,
                added: Number(value.quantity),
                unit: getInventoryUnitAbbreviation(updated.unitName),
                balanceAfter: updated.currentQuantity,
              },
              ...list,
            ].slice(0, MAX_RECENT),
          );
          // Ready for the next delivery.
          this.form.reset({ itemId: '', quantity: null, unitCost: null, notes: '' });
          this.attention.refresh();
        },
        error: (err) => {
          this.isSaving.set(false);
          this.alertService.error(err.message);
        },
      });
  }
}
