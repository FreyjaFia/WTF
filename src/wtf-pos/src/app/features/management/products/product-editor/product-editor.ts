import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AlertService,
  AuthService,
  InventoryService,
  ModalStackService,
  ProductService,
} from '@core/services';
import {
  AddonsSwapperComponent,
  AvatarComponent,
  IconComponent,
  PageTitleComponent,
  PriceHistoryDrawerComponent,
  ProductsSwapperComponent,
} from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import {
  ADD_ON_TYPE_ORDER,
  AddOnGroupDto,
  AddOnProductAssignmentDto,
  CreateProductAddOnPriceOverrideDto,
  CreateProductDto,
  ItemDto,
  PRODUCT_SUB_CATEGORY_LABELS,
  ProductAddOnAssignmentDto,
  ProductAddOnPriceOverrideDto,
  ProductCategoryEnum,
  ProductPriceHistoryDto,
  ProductSubCategoryEnum,
  RecipeCostDto,
  UpdateProductAddOnPriceOverrideDto,
  UpdateProductDto,
} from '@shared/models';
import { salesCovered } from '@shared/calculations';
import { AppRoutes } from '@shared/constants/app-routes';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import { Observable, of, switchMap } from 'rxjs';

export type StockTrackingMode = 'none' | 'own' | 'existing';

@Component({
  selector: 'app-product-editor',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    AddonsSwapperComponent,
    ProductsSwapperComponent,
    PageTitleComponent,
    PriceHistoryDrawerComponent,
    AvatarComponent,
    ConfirmDialogComponent,
  ],
  templateUrl: './product-editor.html',
  host: {
    class: 'block h-full',
  },
})
export class ProductEditorComponent implements OnInit {
  private readonly productService = inject(ProductService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);

  @ViewChild(AddonsSwapperComponent) private addonsSwapper!: AddonsSwapperComponent;
  @ViewChild(ProductsSwapperComponent) private productsSwapper!: ProductsSwapperComponent;

  protected readonly isEditMode = signal(false);
  protected readonly isLoading = signal(false);

  // For avatar fallback
  protected readonly productName = signal('');
  protected readonly isSaving = signal(false);
  protected readonly isUploading = signal(false);
  protected readonly isDeletingImage = signal(false);
  protected readonly isBusy = computed(
    () =>
      this.isSaving() ||
      this.isUploading() ||
      this.isDeletingImage() ||
      Object.values(this.addOnOverrideSaving()).some(Boolean),
  );
  protected readonly isDragging = signal(false);
  protected readonly ProductCategoryEnum = ProductCategoryEnum;
  protected readonly ProductSubCategoryEnum = ProductSubCategoryEnum;
  protected readonly subCategoryLabels = PRODUCT_SUB_CATEGORY_LABELS;
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly imagePreview = signal<string | null>(null);
  protected readonly currentImageUrl = signal<string | null>(null);
  protected readonly isHistoryOpen = signal(false);
  protected readonly priceHistory = signal<ProductPriceHistoryDto[]>([]);
  protected readonly assignedAddOns = signal<AddOnGroupDto[]>([]);
  protected readonly addOnBasePrices = signal<Record<string, number>>({});
  protected readonly addOnPriceOverrides = signal<Record<string, ProductAddOnPriceOverrideDto>>({});
  protected readonly addOnOverrideDrafts = signal<Record<string, string>>({});
  protected readonly addOnOverrideSaving = signal<Record<string, boolean>>({});
  protected readonly linkedProducts = signal<AddOnGroupDto[]>([]);
  protected readonly lastUpdatedAt = signal<string | null>(null);
  protected readonly showAllAddOns = signal(false);
  protected readonly showAllLinked = signal(false);

  protected readonly stockMode = signal<StockTrackingMode>('none');
  protected readonly stockItems = signal<ItemDto[]>([]);
  protected readonly canTrackStock = computed(() => this.authService.canWriteItems());

  protected readonly canReadCosts = computed(() => this.authService.canReadInventoryCosts());
  protected readonly recipeCost = signal<RecipeCostDto | null>(null);
  protected readonly isRecipeCostLoading = signal(false);
  protected readonly recipeCostFailed = signal(false);
  protected readonly canWriteProducts = computed(() => this.authService.canWriteProducts());
  protected readonly multiplierControl = new FormControl<number>(1, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(0.01), Validators.max(10)],
  });
  protected readonly isMultiplierSaving = signal(false);
  protected readonly canWriteCosts = computed(() => this.authService.canWriteInventoryCosts());
  protected readonly suppliesControl = new FormControl<number>(0, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(0), Validators.max(9999.99)],
  });
  protected readonly isSuppliesSaving = signal(false);
  protected readonly isMarginNegative = computed(() => (this.recipeCost()?.marginPercent ?? 0) < 0);

  protected readonly stockForm = new FormGroup({
    startingQuantity: new FormControl<number | null>(null, [Validators.min(0)]),
    costPrice: new FormControl<number | null>(null, [Validators.min(0)]),
    warningQuantity: new FormControl<number | null>(null, [Validators.min(0)]),
    criticalQuantity: new FormControl<number | null>(null, [Validators.min(0)]),
    existingItemId: new FormControl('', { nonNullable: true }),
    quantityPerSale: new FormControl<number | null>(1, [Validators.min(0.001)]),
  });

  private readonly stockValues = toSignal(this.stockForm.valueChanges, {
    initialValue: this.stockForm.getRawValue(),
  });

  // What one sale would take and how many sales the stock covers, before anything is saved.
  protected readonly stockImpact = computed<string | null>(() => {
    const values = this.stockValues();
    const sales = (count: number): string => (count === 1 ? '1 sale' : `${count} sales`);

    if (this.stockMode() === 'own') {
      const covered = salesCovered(Number(values.startingQuantity ?? 0), 1);
      return `Each sale takes 1 piece. The starting stock covers ${sales(covered)}.`;
    }

    if (this.stockMode() !== 'existing') {
      return null;
    }

    const item = this.stockItems().find((candidate) => candidate.id === values.existingItemId);
    const perSale = Number(values.quantityPerSale ?? 0);
    if (!item || perSale <= 0) {
      return null;
    }

    const unit = getInventoryUnitAbbreviation(item.unitName);
    const covered = salesCovered(item.currentQuantity, perSale);
    const stock = `${item.name} has ${item.currentQuantity} ${unit} in stock`;
    if (covered > 0) {
      return `Each sale takes ${perSale} ${unit}. ${stock}, enough for ${sales(covered)}.`;
    }

    return item.allowNegativeStock
      ? `Each sale takes ${perSale} ${unit}. ${stock}, not enough for one sale: it will go below zero and warn.`
      : `Each sale takes ${perSale} ${unit}. ${stock}, not enough for one sale: online sales of this product will be refused until stock is added.`;
  });

  protected readonly sortedAssignedAddOns = computed(() =>
    [...this.assignedAddOns()]
      .sort((a, b) => ADD_ON_TYPE_ORDER[a.type] - ADD_ON_TYPE_ORDER[b.type])
      .map((group) => ({
        ...group,
        options: [...group.options].sort((a, b) => a.name.localeCompare(b.name)),
      })),
  );

  protected readonly sortedLinkedProducts = computed(() =>
    [...this.linkedProducts()]
      .sort((a, b) => ADD_ON_TYPE_ORDER[a.type] - ADD_ON_TYPE_ORDER[b.type])
      .map((group) => ({
        ...group,
        options: [...group.options].sort((a, b) => a.name.localeCompare(b.name)),
      })),
  );

  protected readonly totalAssignedAddOnsCount = computed(() =>
    this.assignedAddOns().reduce((sum, group) => sum + group.options.length, 0),
  );

  protected readonly totalLinkedCount = computed(() =>
    this.linkedProducts().reduce((sum, group) => sum + group.options.length, 0),
  );

  protected readonly productForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.maxLength(10),
        Validators.pattern(/^[A-Z0-9]+$/),
      ],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
    price: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0), Validators.max(999999.99)],
    }),
    category: new FormControl<ProductCategoryEnum>(ProductCategoryEnum.Drink, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    subCategory: new FormControl<ProductSubCategoryEnum | null>(null),
    isAddOn: new FormControl(false, { nonNullable: true }),
    isActive: new FormControl(true, { nonNullable: true }),
  });

  protected productId: string | null = null;

  // Unsaved changes guard
  protected readonly showDiscardModal = signal(false);
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private skipGuard = false;
  private modalStackId: number | null = null;

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.isEditMode.set(true);
      this.productId = id;
      this.loadProduct(id);
      this.productForm.controls.isAddOn.disable();
      this.productForm.controls.code.disable();
    }

    if (id && this.canReadCosts()) {
      this.loadRecipeCost(id);
    }

    if (this.canTrackStock()) {
      this.inventoryService.getInventoryItems({ isActive: true }).subscribe({
        next: (items) => this.stockItems.set(items),
        error: () => this.stockItems.set([]),
      });
    }

    this.productForm.controls.isAddOn.valueChanges.subscribe((isAddOn) => {
      if (isAddOn) {
        this.productForm.controls.category.setValue(ProductCategoryEnum.Other);
        this.productForm.controls.category.disable();
        this.productForm.controls.subCategory.setValue(null);
        this.productForm.controls.subCategory.disable();
      } else {
        this.productForm.controls.category.enable();
        this.productForm.controls.subCategory.enable();
      }
    });
  }

  protected saveMultiplier(): void {
    const id = this.productId;
    if (!id || this.multiplierControl.invalid || this.isMultiplierSaving()) {
      return;
    }

    this.isMultiplierSaving.set(true);
    this.inventoryService.setRecipeMultiplier(id, this.multiplierControl.value).subscribe({
      next: () => {
        this.isMultiplierSaving.set(false);
        this.alertService.successSaved('Size multiplier');
        this.loadRecipeCost(id);
      },
      error: (err: Error) => {
        this.isMultiplierSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected saveSupplies(): void {
    const id = this.productId;
    if (!id || this.suppliesControl.invalid || this.isSuppliesSaving()) {
      return;
    }

    this.isSuppliesSaving.set(true);
    this.inventoryService.setSuppliesCost(id, this.suppliesControl.value).subscribe({
      next: () => {
        this.isSuppliesSaving.set(false);
        this.alertService.successSaved('Supplies cost');
        this.loadRecipeCost(id);
      },
      error: (err: Error) => {
        this.isSuppliesSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  private loadRecipeCost(productId: string): void {
    this.isRecipeCostLoading.set(true);
    this.recipeCostFailed.set(false);

    this.inventoryService.getProductRecipeCost(productId).subscribe({
      next: (cost) => {
        this.recipeCost.set(cost);
        this.multiplierControl.setValue(cost.recipeMultiplier ?? 1);
        this.suppliesControl.setValue(cost.suppliesCost ?? 0);
        this.isRecipeCostLoading.set(false);
      },
      error: () => {
        this.recipeCost.set(null);
        this.recipeCostFailed.set(true);
        this.isRecipeCostLoading.set(false);
      },
    });
  }

  private loadProduct(id: string): void {
    this.isLoading.set(true);

    this.productService.getProduct(id).subscribe({
      next: (product) => {
        this.productForm.patchValue({
          name: product.name,
          code: product.code,
          description: product.description || '',
          price: product.price,
          category: product.category,
          subCategory: product.subCategory ?? null,
          isAddOn: product.isAddOn,
          isActive: product.isActive,
        });
        this.productName.set(product.name);
        this.currentImageUrl.set(product.imageUrl || null);
        this.priceHistory.set(product.priceHistory || []);
        this.lastUpdatedAt.set(product.updatedAt || product.createdAt);

        if (product.isAddOn) {
          this.addOnBasePrices.set({});
          this.addOnPriceOverrides.set({});
          this.addOnOverrideDrafts.set({});
          this.productForm.controls.category.disable();
          this.productForm.controls.subCategory.disable();
          this.loadLinkedProducts(id);
        } else {
          this.loadAssignedAddOns(id);
        }

        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected saveProduct(): void {
    if (this.isBusy()) {
      return;
    }

    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);

    const formValue = this.productForm.getRawValue();

    if (formValue.isAddOn) {
      formValue.category = ProductCategoryEnum.Other;
      formValue.subCategory = null;
    }

    if (this.isEditMode() && this.productId) {
      const updateDto: UpdateProductDto = {
        id: this.productId,
        ...formValue,
      };

      this.productService.updateProduct(updateDto).subscribe({
        next: () => this.setUpStock(this.productId!, updateDto.name).subscribe(() => {
          // If there's a file selected, upload it after updating the product
          if (this.selectedFile()) {
            this.uploadImage();
          } else {
            this.isSaving.set(false);
            this.skipGuard = true;
            this.alertService.successUpdated('Product');
            this.navigateToDetails(this.productId!);
          }
        }),
        error: (err) => {
          this.alertService.error(err.message);
          this.isSaving.set(false);
        },
      });
    } else {
      const createDto: CreateProductDto = {
        ...formValue,
        category: formValue.category as ProductCategoryEnum,
      };

      this.productService.createProduct(createDto).subscribe({
        next: (createdProduct) =>
          this.setUpStock(createdProduct.id, createDto.name).subscribe(() => {
            // If there's a file selected, upload it after creating the product
            if (this.selectedFile()) {
              this.uploadImage(createdProduct.id);
            } else {
              this.isSaving.set(false);
              this.skipGuard = true;
              this.alertService.successCreated('Product');
              this.navigateToDetails(createdProduct.id);
            }
          }),
        error: (err) => {
          this.alertService.error(err.message);
          this.isSaving.set(false);
        },
      });
    }
  }

  protected setStockMode(mode: StockTrackingMode): void {
    this.stockMode.set(mode);
  }

  // The product is already saved when this runs, so a failure here only reports itself and the save carries on.
  private setUpStock(productId: string, productName: string): Observable<unknown> {
    const mode = this.stockMode();
    const value = this.stockForm.getRawValue();
    let setup: Observable<unknown> = of(null);

    if (mode === 'own') {
      setup = this.inventoryService
        .createInventoryItem({
          name: productName,
          unitName: 'piece',
          startingQuantity: Number(value.startingQuantity ?? 0),
          costPrice: value.costPrice,
          warningQuantity: value.warningQuantity,
          criticalQuantity: value.criticalQuantity,
          isActive: true,
        })
        .pipe(switchMap((item) => this.inventoryService.linkProductToItem(productId, item.id, 1)));
    } else if (mode === 'existing' && value.existingItemId) {
      setup = this.inventoryService.linkProductToItem(
        productId,
        value.existingItemId,
        Number(value.quantityPerSale ?? 1),
      );
    }

    return new Observable((subscriber) => {
      setup.subscribe({
        next: () => undefined,
        error: (err: Error) => {
          this.alertService.error(
            `The product was saved, but its stock setup failed: ${err.message} You can link it from the item page.`,
          );
          subscriber.next(null);
          subscriber.complete();
        },
        complete: () => {
          subscriber.next(null);
          subscriber.complete();
        },
      });
    });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (input.files && input.files[0]) {
      const file = input.files[0];

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

      if (!allowedTypes.includes(file.type)) {
        this.alertService.errorInvalidImageType();
        return;
      }

      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        this.alertService.errorFileTooLarge();
        return;
      }

      this.selectedFile.set(file);

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.imagePreview.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  protected removeImage(): void {
    this.selectedFile.set(null);
    this.imagePreview.set(null);

    // Reset file input
    const fileInput = document.getElementById('productImage') as HTMLInputElement;

    if (fileInput) {
      fileInput.value = '';
    }
  }

  protected removeCurrentImage(): void {
    if (!this.productId || !this.currentImageUrl() || this.isDeletingImage()) {
      return;
    }

    this.isDeletingImage.set(true);

    this.productService.deleteProductImage(this.productId).subscribe({
      next: (updatedProduct) => {
        this.currentImageUrl.set(updatedProduct.imageUrl || null);
        this.isDeletingImage.set(false);
        this.alertService.successDeleted('Image');
      },
      error: (err) => {
        this.alertService.error(err.message || this.alertService.getDeleteErrorMessage('image'));
        this.isDeletingImage.set(false);
      },
    });
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  protected onFileDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const file = event.dataTransfer?.files[0];

    if (!file) {
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

    if (!allowedTypes.includes(file.type)) {
      this.alertService.errorInvalidImageType();
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.alertService.errorFileTooLarge();
      return;
    }

    this.selectedFile.set(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      this.imagePreview.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  protected uploadImage(productId?: string): void {
    const file = this.selectedFile();
    const id = productId || this.productId;

    if (!file || !id) {
      return;
    }

    this.isUploading.set(true);

    this.productService.uploadProductImage(id, file).subscribe({
      next: (updatedProduct) => {
        this.currentImageUrl.set(updatedProduct.imageUrl || null);
        this.selectedFile.set(null);
        this.imagePreview.set(null);
        this.isUploading.set(false);
        this.isSaving.set(false);
        this.skipGuard = true;

        if (productId) {
          // If we just created the product and uploaded image, navigate to details
          this.alertService.successCreated('Product');
          this.navigateToDetails(productId);
        } else if (this.productId) {
          // Update flow with image upload
          this.alertService.successUpdated('Product');
          this.navigateToDetails(this.productId);
        }
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isUploading.set(false);
        this.isSaving.set(false);
      },
    });
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.productForm.dirty) {
      return true;
    }

    this.showDiscardModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDiscard());

    return new Promise<boolean>((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
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

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  protected goBack(): void {
    if (this.isEditMode() && this.productId) {
      this.router.navigateByUrl(AppRoutes.ManagementProductDetailsById(this.productId));
    } else {
      this.router.navigateByUrl(AppRoutes.ManagementProducts);
    }
  }

  private navigateToDetails(productId: string): void {
    this.router.navigateByUrl(AppRoutes.ManagementProductDetailsById(productId));
  }

  protected getErrorMessage(controlName: string): string | null {
    const control = this.productForm.get(controlName);

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

    if (control.errors['max']) {
      return `${this.getFieldLabel(controlName)} cannot exceed ${control.errors['max'].max}`;
    }

    if (control.errors['pattern']) {
      if (controlName === 'code') {
        return 'Product code must contain only uppercase letters and numbers';
      }
    }

    return null;
  }

  private getFieldLabel(controlName: string): string {
    const labels: Record<string, string> = {
      name: 'Product name',
      code: 'Product code',
      price: 'Price',
      type: 'Product type',
    };
    return labels[controlName] || controlName;
  }

  protected ingredientsLink(): string {
    return AppRoutes.InventoryIngredientsEditById(this.productId ?? '');
  }

  protected hasError(controlName: string): boolean {
    const control = this.productForm.get(controlName);
    return !!control && control.invalid && control.touched;
  }

  protected onCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const uppercased = input.value.toUpperCase();
    this.productForm.controls.code.setValue(uppercased, { emitEvent: false });
  }

  private loadAssignedAddOns(productId: string): void {
    this.productService.getProductAddOns(productId).subscribe({
      next: (addons) => {
        this.assignedAddOns.set(addons);
        this.loadAddOnBasePrices(addons);
        this.loadAddOnPriceOverrides(productId);
      },
      error: () => {
        this.assignedAddOns.set([]);
        this.addOnBasePrices.set({});
        this.addOnPriceOverrides.set({});
      },
    });
  }

  private loadAddOnBasePrices(addOnGroups: AddOnGroupDto[]): void {
    const assignedIds = new Set(addOnGroups.flatMap((group) => group.options.map((opt) => opt.id)));

    if (assignedIds.size === 0) {
      this.addOnBasePrices.set({});
      return;
    }

    this.productService.getProducts({ isAddOn: true }).subscribe({
      next: (allAddOns) => {
        const baseMap: Record<string, number> = {};

        for (const addOn of allAddOns) {
          if (assignedIds.has(addOn.id)) {
            baseMap[addOn.id] = addOn.price;
          }
        }

        this.addOnBasePrices.set(baseMap);
      },
      error: () => {
        this.addOnBasePrices.set({});
      },
    });
  }

  private loadAddOnPriceOverrides(productId: string): void {
    this.productService.getProductAddOnPriceOverrides(productId).subscribe({
      next: (overrides) => {
        const map: Record<string, ProductAddOnPriceOverrideDto> = {};
        const drafts: Record<string, string> = {};

        for (const override of overrides) {
          if (override.isActive) {
            map[override.addOnId] = override;
            drafts[override.addOnId] = String(override.price);
          }
        }

        this.addOnPriceOverrides.set(map);
        this.addOnOverrideDrafts.set(drafts);
      },
      error: () => {
        this.addOnPriceOverrides.set({});
        this.addOnOverrideDrafts.set({});
      },
    });
  }

  private loadLinkedProducts(productId: string): void {
    this.productService.getLinkedProducts(productId).subscribe({
      next: (linked) => {
        this.linkedProducts.set(linked);
      },
      error: () => this.linkedProducts.set([]),
    });
  }

  protected openAddOnsManager(): void {
    if (!this.productId) {
      this.alertService.error('Please save the product first before managing add-ons.');
      return;
    }

    const modal = document.querySelector('#addons-swapper-modal') as HTMLDialogElement;

    if (modal) {
      if (this.addonsSwapper) {
        this.addonsSwapper.productId = this.productId;
        this.addonsSwapper.ngAfterViewInit();
      }

      // Refresh summary when modal closes
      modal.addEventListener(
        'close',
        () => {
          if (this.productId) {
            this.loadAssignedAddOns(this.productId);
          }
        },
        { once: true },
      );

      modal.showModal();
      this.addonsSwapper.registerOnStack();
    }
  }

  protected openProductsManager(): void {
    if (!this.productId) {
      this.alertService.error('Please save the product first before managing linked products.');
      return;
    }

    const modal = document.querySelector('#products-swapper-modal') as HTMLDialogElement;

    if (modal) {
      if (this.productsSwapper) {
        this.productsSwapper.addOnId = this.productId;
        this.productsSwapper.ngAfterViewInit();
      }

      modal.addEventListener(
        'close',
        () => {
          if (this.productId) {
            this.loadLinkedProducts(this.productId);
          }
        },
        { once: true },
      );

      modal.showModal();
      this.productsSwapper.registerOnStack();
    }
  }

  protected openPriceHistory(): void {
    this.isHistoryOpen.set(true);
  }

  protected closePriceHistory(): void {
    this.isHistoryOpen.set(false);
  }

  protected removeAddOn(addOnId: string): void {
    if (!this.productId) {
      return;
    }

    // Remove from groups and rebuild assignment payload
    const updatedGroups = this.assignedAddOns()
      .map((group) => ({
        ...group,
        options: group.options.filter((opt) => opt.id !== addOnId),
      }))
      .filter((group) => group.options.length > 0);

    const assignments: ProductAddOnAssignmentDto[] = updatedGroups.flatMap((group) =>
      group.options.map((opt) => ({ addOnId: opt.id, addOnType: group.type })),
    );

    // Optimistic update
    this.assignedAddOns.set(updatedGroups);

    this.productService.assignProductAddOns(this.productId, assignments).subscribe({
      next: () => {
        this.alertService.successDeleted('Add-on');
      },
      error: () => {
        this.alertService.error(this.alertService.getUpdateErrorMessage('product add-ons'));
        if (this.productId) {
          this.loadAssignedAddOns(this.productId);
        }
      },
    });
  }

  protected hasAddOnPriceOverride(addOnId: string): boolean {
    return !!this.addOnPriceOverrides()[addOnId];
  }

  protected getAddOnBasePrice(addOnId: string, fallbackPrice: number): number {
    return this.addOnBasePrices()[addOnId] ?? fallbackPrice;
  }

  protected getAddOnEffectivePrice(addOnId: string, fallbackPrice: number): number {
    const basePrice = this.getAddOnBasePrice(addOnId, fallbackPrice);
    return this.addOnPriceOverrides()[addOnId]?.price ?? basePrice;
  }

  protected getAddOnOverrideDraft(addOnId: string): string {
    return this.addOnOverrideDrafts()[addOnId] ?? '';
  }

  protected onAddOnOverrideInput(addOnId: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const next = { ...this.addOnOverrideDrafts() };
    next[addOnId] = input.value;
    this.addOnOverrideDrafts.set(next);
  }

  protected isAddOnOverrideSaving(addOnId: string): boolean {
    return !!this.addOnOverrideSaving()[addOnId];
  }

  protected isAddOnOverridden(addOnId: string): boolean {
    return this.hasAddOnPriceOverride(addOnId);
  }

  private setAddOnOverrideSaving(addOnId: string, isSaving: boolean): void {
    const next = { ...this.addOnOverrideSaving() };
    next[addOnId] = isSaving;
    this.addOnOverrideSaving.set(next);
  }

  protected saveAddOnPriceOverride(addOnId: string, defaultPrice: number): void {
    if (!this.productId) {
      return;
    }

    const rawDraft = this.getAddOnOverrideDraft(addOnId).trim();

    if (!rawDraft) {
      if (this.hasAddOnPriceOverride(addOnId)) {
        this.clearAddOnPriceOverride(addOnId);
      }
      return;
    }

    const parsedPrice = Number(rawDraft);

    if (!Number.isFinite(parsedPrice)) {
      this.alertService.error('Override price must be a valid amount.');
      return;
    }

    if (!this.hasAddOnPriceOverride(addOnId) && parsedPrice === defaultPrice) {
      return;
    }

    this.setAddOnOverrideSaving(addOnId, true);

    const hasExistingOverride = this.hasAddOnPriceOverride(addOnId);
    const payload = {
      productId: this.productId,
      addOnId,
      price: parsedPrice,
      isActive: true,
    };

    const request$ = hasExistingOverride
      ? this.productService.updateProductAddOnPriceOverride(
          payload as UpdateProductAddOnPriceOverrideDto,
        )
      : this.productService.createProductAddOnPriceOverride(
          payload as CreateProductAddOnPriceOverrideDto,
        );

    request$.subscribe({
      next: (savedOverride) => {
        const nextOverrides = { ...this.addOnPriceOverrides() };
        nextOverrides[addOnId] = savedOverride;
        this.addOnPriceOverrides.set(nextOverrides);

        const nextDrafts = { ...this.addOnOverrideDrafts() };
        nextDrafts[addOnId] = String(savedOverride.price);
        this.addOnOverrideDrafts.set(nextDrafts);

        this.setAddOnOverrideSaving(addOnId, false);
        this.alertService.successSaved('Add-on price override');
      },
      error: (err) => {
        this.setAddOnOverrideSaving(addOnId, false);
        this.alertService.error(err.message || this.alertService.getUpdateErrorMessage('override'));
      },
    });
  }

  protected clearAddOnPriceOverride(addOnId: string): void {
    if (!this.productId || !this.hasAddOnPriceOverride(addOnId)) {
      return;
    }

    this.setAddOnOverrideSaving(addOnId, true);

    this.productService.deleteProductAddOnPriceOverride(this.productId, addOnId).subscribe({
      next: () => {
        const nextOverrides = { ...this.addOnPriceOverrides() };
        delete nextOverrides[addOnId];
        this.addOnPriceOverrides.set(nextOverrides);

        const nextDrafts = { ...this.addOnOverrideDrafts() };
        delete nextDrafts[addOnId];
        this.addOnOverrideDrafts.set(nextDrafts);

        this.setAddOnOverrideSaving(addOnId, false);
        this.alertService.successDeleted('Add-on price override');
      },
      error: (err) => {
        this.setAddOnOverrideSaving(addOnId, false);
        this.alertService.error(err.message || this.alertService.getDeleteErrorMessage('override'));
      },
    });
  }

  protected removeLinkedProduct(linkedProductId: string): void {
    if (!this.productId) {
      return;
    }

    // Remove from groups and rebuild assignment payload
    const updatedGroups = this.linkedProducts()
      .map((group) => ({
        ...group,
        options: group.options.filter((opt) => opt.id !== linkedProductId),
      }))
      .filter((group) => group.options.length > 0);

    const assignments: AddOnProductAssignmentDto[] = updatedGroups.flatMap((group) =>
      group.options.map((opt) => ({ productId: opt.id, addOnType: group.type })),
    );

    // Optimistic update
    this.linkedProducts.set(updatedGroups);

    this.productService.assignLinkedProducts(this.productId, assignments).subscribe({
      next: () => {
        this.alertService.successDeleted('Linked product');
      },
      error: () => {
        this.alertService.error(this.alertService.getUpdateErrorMessage('linked products'));
        if (this.productId) {
          this.loadLinkedProducts(this.productId);
        }
      },
    });
  }
}
