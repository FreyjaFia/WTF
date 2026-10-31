import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  FormRecord,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, AuthService, InventoryService, ModalStackService } from '@core/services';
import {
  margin,
  marginPercent,
  recipeCost,
  RecipeCostLine,
} from '@shared/calculations/recipe-cost';
import { IconComponent, PageTitleComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import {
  ItemDto,
  ProductIngredientInputDto,
  ProductIngredientsEditDto,
  RecipePreviewDto,
} from '@shared/models';
import { forkJoin, Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

type LineGroup = FormGroup<{
  itemId: FormControl<string>;
  quantityPerSale: FormControl<number>;
  allowancePercent: FormControl<number>;
  scalesWithSize: FormControl<boolean>;
  replacesItemId: FormControl<string>;
  sizeAmounts: FormRecord<FormControl<number | null>>;
}>;

interface LineValue {
  itemId: string;
  quantityPerSale: number;
  allowancePercent: number;
  scalesWithSize: boolean;
  replacesItemId: string;
  sizeAmounts: Record<string, number>;
}

@Component({
  selector: 'app-ingredient-editor',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    IconComponent,
    PageTitleComponent,
    ConfirmDialogComponent,
  ],
  templateUrl: './ingredient-editor.html',
  host: { class: 'flex-1 min-h-0' },
})
export class IngredientEditorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);

  protected readonly product = signal<ProductIngredientsEditDto | null>(null);
  protected readonly items = signal<ItemDto[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly showDiscardModal = signal(false);
  protected readonly formVersion = signal(0);
  protected readonly preview = signal<RecipePreviewDto | null>(null);
  protected readonly previewSizeId = signal('');
  protected readonly previewAddOnIds = signal<string[]>([]);

  protected readonly form = new FormGroup({
    suppliesCost: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    lines: new FormArray<LineGroup>([]),
  });

  protected readonly canWrite = computed(() => this.authService.canWriteItems());
  protected readonly showsCosts = computed(() => this.product()?.showsCosts ?? false);
  protected readonly canEditSupplies = computed(
    () => this.showsCosts() && this.authService.canWriteInventoryCosts() && this.canWrite(),
  );
  protected readonly sizes = computed(() => this.product()?.sizes ?? []);
  protected readonly previewSizes = computed(() =>
    (this.product()?.addOnOptions ?? []).filter((option) => option.isSize),
  );
  protected readonly previewExtras = computed(() =>
    (this.product()?.addOnOptions ?? []).filter((option) => !option.isSize),
  );
  protected readonly showsSizeGrid = computed(
    () => !(this.product()?.isAddOn ?? true) && this.sizes().length > 0,
  );
  protected readonly showsPreview = computed(
    () => this.showsCosts() && !(this.product()?.isAddOn ?? true),
  );
  protected readonly itemsById = computed(
    () => new Map(this.items().map((item) => [item.id, item])),
  );

  protected readonly summary = computed(() => {
    this.formVersion();
    const product = this.product();
    if (!product || !product.showsCosts) {
      return null;
    }

    const lines: RecipeCostLine[] = this.lines.controls.map((group) => {
      const value = group.getRawValue();
      return {
        quantityPerSale: Number(value.quantityPerSale) || 0,
        allowancePercent: Number(value.allowancePercent) || 0,
        unitCost: this.unitCostOf(value.itemId),
      };
    });
    const supplies = Number(this.form.controls.suppliesCost.value) || 0;
    const result = recipeCost(lines, supplies);
    return {
      totalCost: result.totalCost,
      unknownCostCount: result.unknownCostCount,
      margin: margin(product.price, result.totalCost),
      marginPercent: marginPercent(product.price, result.totalCost),
    };
  });

  protected readonly unusedItems = computed(() => {
    this.formVersion();
    const used = new Set(this.lines.controls.map((group) => group.controls.itemId.value));
    return this.items().filter((item) => !used.has(item.id));
  });

  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private modalStackId: number | null = null;
  private productId = '';

  protected get lines(): FormArray<LineGroup> {
    return this.form.controls.lines;
  }

  public ngOnInit(): void {
    this.productId = this.route.snapshot.paramMap.get('productId') ?? '';
    this.form.valueChanges.subscribe(() => this.formVersion.update((v) => v + 1));
    this.load();
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (!this.form.dirty) {
      return true;
    }

    this.showDiscardModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDiscard());

    return new Promise<boolean>((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected addLine(itemId: string): void {
    if (!itemId) {
      return;
    }

    this.lines.push(this.createLine({ itemId, quantityPerSale: 1 }));
    this.form.markAsDirty();
    this.formVersion.update((v) => v + 1);
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.form.markAsDirty();
    this.formVersion.update((v) => v + 1);
  }

  protected itemOptionsFor(index: number): ItemDto[] {
    const current = this.lines.at(index).controls.itemId.value;
    const free = new Set(this.unusedItems().map((item) => item.id));
    return this.items().filter((item) => item.id === current || free.has(item.id));
  }

  protected unitOf(itemId: string): string {
    const unit = this.itemsById().get(itemId)?.unitName;
    return getInventoryUnitAbbreviation(unit ?? this.knownUnit(itemId));
  }

  protected lineCostOf(index: number): number | null {
    this.formVersion();
    const value = this.lines.at(index).getRawValue();
    const unitCost = this.unitCostOf(value.itemId);
    if (unitCost === null) {
      return null;
    }

    return recipeCost(
      [
        {
          quantityPerSale: Number(value.quantityPerSale) || 0,
          allowancePercent: Number(value.allowancePercent) || 0,
          unitCost,
        },
      ],
      0,
    ).totalCost;
  }

  protected save(): void {
    if (this.form.invalid || this.isSaving() || !this.canWrite()) {
      this.form.markAllAsTouched();
      return;
    }

    const lines = this.toInputs();
    const supplies = Number(this.form.controls.suppliesCost.value) || 0;
    const suppliesChanged =
      this.canEditSupplies() && supplies !== (this.product()?.suppliesCost ?? 0);

    this.isSaving.set(true);
    const saveSupplies$: Observable<unknown> = suppliesChanged
      ? this.inventoryService.setSuppliesCost(this.productId, supplies)
      : of(null);

    saveSupplies$
      .pipe(switchMap(() => this.inventoryService.saveProductIngredients(this.productId, lines)))
      .subscribe({
        next: (result) => {
          this.applyProduct(result);
          this.isSaving.set(false);
          this.alertService.success('Ingredients saved.');
          this.loadPreview();
        },
        error: (err) => {
          this.isSaving.set(false);
          this.alertService.error(err.message);
        },
      });
  }

  protected fillSize(sizeId: string): void {
    const multiplier =
      this.sizes().find((size) => size.productId === sizeId)?.recipeMultiplier ?? 1;
    for (const group of this.lines.controls) {
      const cell = group.controls.sizeAmounts.controls[sizeId];
      const base = Number(group.controls.quantityPerSale.value) || 0;
      const scaled = Math.round(base * multiplier * 1000) / 1000;
      // A whole piece (a cup, a lid) cannot be scaled by 1.5, so it keeps the drink's amount
      const isWholePiece =
        this.unitOf(group.controls.itemId.value) === 'pc' && !Number.isInteger(scaled);
      if (cell && (cell.value === null || cell.value === undefined) && base > 0 && !isWholePiece) {
        cell.setValue(scaled);
      }
    }

    this.form.markAsDirty();
    this.formVersion.update((v) => v + 1);
  }

  protected sizeCell(group: LineGroup, sizeId: string): FormControl<number | null> {
    return group.controls.sizeAmounts.controls[sizeId];
  }

  protected chooseSize(sizeId: string): void {
    this.previewSizeId.set(sizeId);
    this.loadPreview();
  }

  protected toggleExtra(addOnId: string, on: boolean): void {
    this.previewAddOnIds.update((ids) =>
      on ? [...ids.filter((id) => id !== addOnId), addOnId] : ids.filter((id) => id !== addOnId),
    );
    this.loadPreview();
  }

  protected goBack(): void {
    this.router.navigateByUrl(AppRoutes.InventoryIngredients);
  }

  protected confirmDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);
    this.pendingDeactivateResolve?.(true);
    this.pendingDeactivateResolve = null;
  }

  protected cancelDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);
    this.pendingDeactivateResolve?.(false);
    this.pendingDeactivateResolve = null;
  }

  private load(): void {
    this.isLoading.set(true);
    forkJoin({
      product: this.inventoryService.getProductIngredientsEdit(this.productId),
      items: this.inventoryService.getInventoryItems({ isActive: true }),
    }).subscribe({
      next: ({ product, items }) => {
        this.items.set(items.filter((item) => item.isActive));
        this.applyProduct(product);
        this.isLoading.set(false);
        this.loadPreview();
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  private loadPreview(): void {
    if (!this.showsPreview()) {
      return;
    }

    const ids = [...this.previewAddOnIds()];
    if (this.previewSizeId()) {
      ids.push(this.previewSizeId());
    }

    this.inventoryService.getProductRecipePreview(this.productId, ids).subscribe({
      next: (result) => this.preview.set(result),
      error: (err) => this.alertService.error(err.message),
    });
  }

  private applyProduct(product: ProductIngredientsEditDto): void {
    this.product.set(product);
    this.lines.clear();
    for (const line of product.lines) {
      this.lines.push(
        this.createLine({
          itemId: line.itemId,
          quantityPerSale: line.quantityPerSale,
          allowancePercent: line.allowancePercent,
          scalesWithSize: line.scalesWithSize,
          replacesItemId: line.replacesItemId ?? '',
          sizeAmounts: Object.fromEntries(
            (line.sizeAmounts ?? []).map((amount) => [amount.sizeProductId, amount.quantity]),
          ),
        }),
      );
    }

    this.form.controls.suppliesCost.setValue(product.suppliesCost ?? 0, { emitEvent: false });
    if (!this.canWrite()) {
      this.form.disable({ emitEvent: false });
    }

    this.form.markAsPristine();
    this.formVersion.update((v) => v + 1);
  }

  private createLine(value: Partial<LineValue>): LineGroup {
    return new FormGroup({
      itemId: new FormControl(value.itemId ?? '', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      quantityPerSale: new FormControl(value.quantityPerSale ?? 1, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0.001), Validators.max(999999.999)],
      }),
      allowancePercent: new FormControl(value.allowancePercent ?? 0, {
        nonNullable: true,
        validators: [Validators.min(0), Validators.max(100)],
      }),
      scalesWithSize: new FormControl(value.scalesWithSize ?? false, { nonNullable: true }),
      replacesItemId: new FormControl(value.replacesItemId ?? '', { nonNullable: true }),
      sizeAmounts: new FormRecord<FormControl<number | null>>(
        Object.fromEntries(
          this.sizes().map((size) => [
            size.productId,
            new FormControl<number | null>(value.sizeAmounts?.[size.productId] ?? null, {
              validators: [Validators.min(0.001), Validators.max(999999.999)],
            }),
          ]),
        ),
      ),
    });
  }

  private toInputs(): ProductIngredientInputDto[] {
    const isAddOn = this.product()?.isAddOn ?? false;
    return this.lines.controls.map((group) => {
      const value = group.getRawValue();
      return {
        itemId: value.itemId,
        quantityPerSale: Number(value.quantityPerSale),
        allowancePercent: Number(value.allowancePercent) || 0,
        scalesWithSize: value.scalesWithSize,
        replacesItemId: isAddOn && value.replacesItemId ? value.replacesItemId : null,
        sizeAmounts: Object.entries(value.sizeAmounts)
          .filter(([, quantity]) => quantity !== null && Number(quantity) > 0)
          .map(([sizeProductId, quantity]) => ({ sizeProductId, quantity: Number(quantity) })),
      };
    });
  }

  private unitCostOf(itemId: string): number | null {
    const item = this.itemsById().get(itemId);
    if (item) {
      return item.usableCost ?? null;
    }

    return this.product()?.lines.find((line) => line.itemId === itemId)?.unitCost ?? null;
  }

  private knownUnit(itemId: string): string {
    return this.product()?.lines.find((line) => line.itemId === itemId)?.unitName ?? '';
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
