import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertService, InventoryService } from '@core/services';
import { SideDrawerComponent } from '@shared/components/side-drawer/side-drawer';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { BulkAddIngredientsResultDto, ItemDto, ProductIngredientsRowDto } from '@shared/models';

type LineGroup = FormGroup<{
  itemId: FormControl<string>;
  quantityPerSale: FormControl<number>;
  allowancePercent: FormControl<number>;
}>;

@Component({
  selector: 'app-bulk-add-ingredients',
  imports: [ReactiveFormsModule, SideDrawerComponent],
  templateUrl: './bulk-add-ingredients.html',
})
export class BulkAddIngredientsComponent {
  private readonly inventoryService = inject(InventoryService);
  private readonly alertService = inject(AlertService);

  public readonly isOpen = input(false);
  public readonly products = input.required<ProductIngredientsRowDto[]>();

  public readonly closed = output<void>();
  public readonly added = output<void>();

  protected readonly items = signal<ItemDto[]>([]);
  protected readonly search = signal('');
  protected readonly selected = signal<ReadonlySet<string>>(new Set<string>());
  protected readonly isSaving = signal(false);
  protected readonly result = signal<BulkAddIngredientsResultDto | null>(null);
  protected readonly formVersion = signal(0);

  protected readonly lines = new FormArray<LineGroup>([]);

  private itemsRequested = false;

  protected readonly shownProducts = computed(() => {
    const term = this.search().trim().toLowerCase();
    return [...this.products()]
      .filter((product) => !term || product.name.toLowerCase().includes(term))
      .sort(
        (a, b) =>
          Number(a.ingredientCount > 0) - Number(b.ingredientCount > 0) ||
          a.name.localeCompare(b.name),
      );
  });

  protected readonly groups = computed(() => {
    const byName = new Map<string, ProductIngredientsRowDto[]>();
    for (const product of this.shownProducts()) {
      const name = product.subCategoryName || 'Other';
      byName.set(name, [...(byName.get(name) ?? []), product]);
    }

    return [...byName.entries()]
      .map(([name, products]) => ({ name, products }))
      .sort(
        (a, b) =>
          Number(a.name === 'Other') - Number(b.name === 'Other') || a.name.localeCompare(b.name),
      );
  });

  protected readonly unusedItems = computed(() => {
    this.formVersion();
    const used = new Set(this.lines.controls.map((group) => group.controls.itemId.value));
    return this.items().filter((item) => !used.has(item.id));
  });

  protected readonly canSubmit = computed(() => {
    this.formVersion();
    return (
      this.selected().size > 0 &&
      this.lines.length > 0 &&
      this.lines.valid &&
      !this.isSaving() &&
      this.result() === null
    );
  });

  public constructor() {
    effect(() => {
      if (this.isOpen() && !this.itemsRequested) {
        this.itemsRequested = true;
        this.inventoryService.getInventoryItems({ isActive: true }).subscribe({
          next: (items) => this.items.set(items.filter((item) => item.isActive)),
          error: (err) => {
            this.itemsRequested = false;
            this.alertService.error(err.message);
          },
        });
      }
    });

    this.lines.valueChanges.subscribe(() => this.formVersion.update((v) => v + 1));
  }

  protected isSelected(productId: string): boolean {
    return this.selected().has(productId);
  }

  protected toggleProduct(productId: string, on: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (on) {
        next.add(productId);
      } else {
        next.delete(productId);
      }

      return next;
    });
  }

  protected selectShown(): void {
    this.selected.update((current) => {
      const next = new Set(current);
      this.shownProducts().forEach((product) => next.add(product.productId));
      return next;
    });
  }

  protected clearSelection(): void {
    this.selected.set(new Set<string>());
  }

  protected setSearch(value: string): void {
    this.search.set(value);
  }

  protected addLine(itemId: string): void {
    if (!itemId) {
      return;
    }

    this.lines.push(
      new FormGroup({
        itemId: new FormControl(itemId, { nonNullable: true, validators: [Validators.required] }),
        quantityPerSale: new FormControl(1, {
          nonNullable: true,
          validators: [Validators.required, Validators.min(0.001), Validators.max(999999.999)],
        }),
        allowancePercent: new FormControl(0, {
          nonNullable: true,
          validators: [Validators.min(0), Validators.max(100)],
        }),
      }),
    );
    this.formVersion.update((v) => v + 1);
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.formVersion.update((v) => v + 1);
  }

  protected itemName(itemId: string): string {
    return this.items().find((item) => item.id === itemId)?.name ?? '';
  }

  protected unitOf(itemId: string): string {
    return getInventoryUnitAbbreviation(
      this.items().find((item) => item.id === itemId)?.unitName ?? '',
    );
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.isSaving.set(true);
    this.inventoryService
      .bulkAddIngredients(
        [...this.selected()],
        this.lines.controls.map((group) => {
          const value = group.getRawValue();
          return {
            itemId: value.itemId,
            quantityPerSale: Number(value.quantityPerSale),
            allowancePercent: Number(value.allowancePercent) || 0,
          };
        }),
      )
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.isSaving.set(false);
          this.added.emit();
        },
        error: (err) => {
          this.isSaving.set(false);
          this.alertService.error(err.message);
        },
      });
  }

  protected close(): void {
    this.reset();
    this.closed.emit();
  }

  private reset(): void {
    this.lines.clear();
    this.selected.set(new Set<string>());
    this.search.set('');
    this.result.set(null);
    this.formVersion.update((v) => v + 1);
  }
}
