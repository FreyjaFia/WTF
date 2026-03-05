import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, ModalStackService, ProductService, PromotionService } from '@core/services';
import { AvatarComponent, BundleItemSelection, BundleItemsSelectorComponent, IconComponent } from '@shared/components';
import {
  ADD_ON_TYPE_ORDER,
  AddOnGroupDto,
  MixMatchPromotionDto,
  FixedBundlePromotionDto,
  ProductDto,
} from '@shared/models';
import { forkJoin } from 'rxjs';

type PromoEditorType = 'fixed-bundle' | 'mix-match';

@Component({
  selector: 'app-promotion-editor',
  imports: [CommonModule, FormsModule, IconComponent, AvatarComponent, BundleItemsSelectorComponent],
  templateUrl: './promotion-editor.html',
  host: { class: 'flex-1 min-h-0' },
})
export class PromotionEditorComponent implements OnInit {
  private readonly bundleItemsSelector = viewChild.required(BundleItemsSelectorComponent);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly promotionService = inject(PromotionService);
  private readonly productService = inject(ProductService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);

  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isUploading = signal(false);
  protected readonly isDeletingImage = signal(false);
  protected readonly isDragging = signal(false);
  protected readonly imagePreview = signal<string | null>(null);
  protected readonly currentImageUrl = signal<string | null>(null);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly products = signal<ProductDto[]>([]);
  protected readonly lastUpdatedAt = signal<string | null>(null);
  protected readonly allowedAddOnsByProductId = signal<Record<string, ProductDto[]>>({});
  protected readonly allowedAddOnGroupsByProductId = signal<Record<string, AddOnGroupDto[]>>({});
  protected readonly type = signal<PromoEditorType>('fixed-bundle');
  protected readonly showAllBundleItems = signal(false);
  protected readonly bundleItemQuantityDraft = signal<Record<string, string>>({});
  protected readonly showDiscardModal = signal(false);
  private promotionId: string | null = null;
  private initialEditorSnapshot = '';
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private skipGuard = false;
  private modalStackId: number | null = null;

  protected readonly fixedBundle = signal<Omit<FixedBundlePromotionDto, 'id'>>({
    name: '',
    isActive: true,
    startDate: null,
    endDate: null,
    bundlePrice: 0,
    items: [],
  });

  protected readonly mixMatch = signal<Omit<MixMatchPromotionDto, 'id'>>({
    name: '',
    isActive: true,
    startDate: null,
    endDate: null,
    requiredQuantity: 1,
    maxSelectionsPerOrder: null,
    bundlePrice: 0,
    items: [],
  });

  protected readonly isEditMode = computed(() => !!this.promotionId);
  protected readonly currentPromotionName = computed(() =>
    this.type() === 'fixed-bundle' ? this.fixedBundle().name : this.mixMatch().name,
  );

  public ngOnInit(): void {
    this.type.set(this.resolveTypeFromRoute());
    this.promotionId = this.route.snapshot.paramMap.get('id');
    this.loadData();
  }

  protected loadData(): void {
    this.isLoading.set(true);
    const products$ = this.productService.getProducts({ isActive: true });

    if (!this.promotionId) {
      products$.subscribe({
        next: (products) => {
          this.products.set(products);
          this.snapshotEditorState();
          this.isLoading.set(false);
        },
        error: (err: Error) => {
          this.alertService.error(err.message);
          this.isLoading.set(false);
        },
      });
      return;
    }

    if (this.type() === 'mix-match') {
      forkJoin({
        products: products$,
        promo: this.promotionService.getMixMatchPromotion(this.promotionId),
      }).subscribe({
        next: ({ products, promo }) => {
          this.products.set(products);
          this.lastUpdatedAt.set(promo.updatedAt ?? promo.createdAt ?? null);
          this.mixMatch.set({
            name: promo.name,
            isActive: promo.isActive,
            startDate: promo.startDate,
            endDate: promo.endDate,
            imageUrl: promo.imageUrl ?? null,
            requiredQuantity: promo.requiredQuantity,
            maxSelectionsPerOrder: promo.maxSelectionsPerOrder,
            bundlePrice: promo.bundlePrice,
            items: promo.items,
          });

          for (const item of promo.items) {
            this.ensureAllowedAddOnsLoaded(item.productId);
          }
          this.currentImageUrl.set(promo.imageUrl ?? null);
          this.snapshotEditorState();
          this.isLoading.set(false);
        },
        error: (err: Error) => {
          this.alertService.error(err.message);
          this.isLoading.set(false);
        },
      });
      return;
    }

    forkJoin({
      products: products$,
      promo: this.promotionService.getFixedBundle(this.promotionId),
    }).subscribe({
      next: ({ products, promo }) => {
        this.products.set(products);
        this.lastUpdatedAt.set(promo.updatedAt ?? promo.createdAt ?? null);
        this.fixedBundle.set({
          name: promo.name,
          isActive: promo.isActive,
          startDate: promo.startDate,
          endDate: promo.endDate,
          imageUrl: promo.imageUrl ?? null,
          bundlePrice: promo.bundlePrice,
          items: promo.items,
        });

        this.currentImageUrl.set(promo.imageUrl ?? null);
        for (const item of promo.items) {
          this.ensureAllowedAddOnsLoaded(item.productId);
        }

        this.snapshotEditorState();
        this.isLoading.set(false);
      },
      error: (err: Error) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected getMainProducts(): ProductDto[] {
    return this.products().filter((x) => !x.isAddOn);
  }

  protected getProductName(productId: string): string {
    return this.products().find((x) => x.id === productId)?.name ?? '';
  }

  protected getAddOnName(addOnProductId: string): string {
    return this.products().find((x) => x.id === addOnProductId)?.name ?? 'Unknown add-on';
  }

  protected getProductCode(productId: string): string | null {
    return this.products().find((x) => x.id === productId)?.code ?? null;
  }

  protected getProductImageUrl(productId: string): string | null {
    return this.products().find((x) => x.id === productId)?.imageUrl ?? null;
  }

  protected getPromotionTypeLabel(type: PromoEditorType): string {
    return type === 'mix-match' ? 'Mix & Match' : 'Fixed Bundle';
  }

  protected getBundleItemAddOnGroups(itemIndex: number): {
    typeLabel: string;
    options: { addOnProductId: string; quantity: number }[];
  }[] {
    const item = this.fixedBundle().items[itemIndex];
    if (!item?.productId || item.addOns.length === 0) {
      return [];
    }

    const groups = this.allowedAddOnGroupsByProductId()[item.productId] ?? [];
    const typeLabelByAddOnId = new Map<string, { order: number; label: string }>();

    for (const group of groups) {
      for (const option of group.options) {
        typeLabelByAddOnId.set(option.id, {
          order: ADD_ON_TYPE_ORDER[group.type],
          label: group.displayName,
        });
      }
    }

    const grouped = new Map<string, { order: number; options: { addOnProductId: string; quantity: number }[] }>();
    for (const addOn of item.addOns) {
      const meta = typeLabelByAddOnId.get(addOn.addOnProductId) ?? { order: 999, label: 'Other' };
      const existing = grouped.get(meta.label) ?? { order: meta.order, options: [] };
      existing.options.push(addOn);
      grouped.set(meta.label, existing);
    }

    return [...grouped.entries()]
      .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
      .map(([typeLabel, value]) => ({
        typeLabel,
        options: [...value.options].sort((a, b) =>
          this.getAddOnName(a.addOnProductId).localeCompare(this.getAddOnName(b.addOnProductId)),
        ),
      }));
  }

  protected getMixMatchItemAddOnGroups(itemIndex: number): {
    typeLabel: string;
    options: { addOnProductId: string; quantity: number }[];
  }[] {
    const item = this.mixMatch().items[itemIndex];
    if (!item?.productId || item.addOns.length === 0) {
      return [];
    }

    const groups = this.allowedAddOnGroupsByProductId()[item.productId] ?? [];
    const typeLabelByAddOnId = new Map<string, { order: number; label: string }>();

    for (const group of groups) {
      for (const option of group.options) {
        typeLabelByAddOnId.set(option.id, {
          order: ADD_ON_TYPE_ORDER[group.type],
          label: group.displayName,
        });
      }
    }

    const grouped = new Map<string, { order: number; options: { addOnProductId: string; quantity: number }[] }>();
    for (const addOn of item.addOns) {
      const meta = typeLabelByAddOnId.get(addOn.addOnProductId) ?? { order: 999, label: 'Other' };
      const existing = grouped.get(meta.label) ?? { order: meta.order, options: [] };
      existing.options.push(addOn);
      grouped.set(meta.label, existing);
    }

    return [...grouped.entries()]
      .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
      .map(([typeLabel, value]) => ({
        typeLabel,
        options: [...value.options].sort((a, b) =>
          this.getAddOnName(a.addOnProductId).localeCompare(this.getAddOnName(b.addOnProductId)),
        ),
      }));
  }

  protected getFixedBundleStartLocal(): string {
    return this.utcToLocalInput(this.fixedBundle().startDate);
  }

  protected getFixedBundleEndLocal(): string {
    return this.utcToLocalInput(this.fixedBundle().endDate);
  }

  protected getMixMatchStartLocal(): string {
    return this.utcToLocalInput(this.mixMatch().startDate);
  }

  protected getMixMatchEndLocal(): string {
    return this.utcToLocalInput(this.mixMatch().endDate);
  }

  protected setFixedBundleName(value: string): void {
    this.fixedBundle.update((state) => ({ ...state, name: value }));
  }

  protected setFixedBundleStartAtUtc(value: string): void {
    this.fixedBundle.update((state) => ({ ...state, startDate: this.localInputToUtc(value) }));
  }

  protected setFixedBundleEndAtUtc(value: string): void {
    this.fixedBundle.update((state) => ({ ...state, endDate: this.localInputToUtc(value) }));
  }

  protected setFixedBundleIsActive(value: boolean): void {
    this.fixedBundle.update((state) => ({ ...state, isActive: value }));
  }

  protected setFixedBundlePrice(value: number): void {
    this.fixedBundle.update((state) => ({ ...state, bundlePrice: Number(value) || 0 }));
  }

  protected addFixedBundleItem(): void {
    this.fixedBundle.update((value) => ({
      ...value,
      items: [...value.items, { productId: '', quantity: 1, addOns: [] }],
    }));
  }

  protected openBundleItemsSelector(): void {
    const sourceItems = this.type() === 'fixed-bundle' ? this.fixedBundle().items : this.mixMatch().items;
    const selectedItems: BundleItemSelection[] = sourceItems
      .filter((x) => !!x.productId)
      .map((x) => ({
        productId: x.productId,
        addOns: x.addOns,
      }));

    this.bundleItemsSelector().open(this.getMainProducts(), selectedItems);
  }

  protected onBundleItemsSelected(items: BundleItemSelection[]): void {
    if (this.type() === 'fixed-bundle') {
      const existingByProductId = new Map(
        this.fixedBundle().items.map((item) => [item.productId, item] as const),
      );

      const nextItems = items.map((selected) => {
        const productId = selected.productId;
        const existing = existingByProductId.get(productId);
        return existing
          ? { ...existing, addOns: selected.addOns }
          : {
              productId,
              quantity: 1,
              addOns: selected.addOns,
            };
      });

      this.fixedBundle.update((state) => ({
        ...state,
        items: nextItems,
      }));
    } else {
      this.mixMatch.update((state) => ({
        ...state,
        items: items.map((selected) => ({
          productId: selected.productId,
          addOns: selected.addOns,
        })),
      }));
    }

    for (const id of items.map((x) => x.productId)) {
      this.ensureAllowedAddOnsLoaded(id);
    }
  }

  protected removeFixedBundleItem(index: number): void {
    this.fixedBundle.update((value) => ({
      ...value,
      items: value.items.filter((_, i) => i !== index),
    }));
  }

  protected updateFixedBundleItemProduct(itemIndex: number, productId: string): void {
    this.ensureAllowedAddOnsLoaded(productId);
    this.fixedBundle.update((state) => ({
      ...state,
      items: state.items.map((item, idx) =>
        idx === itemIndex ? { ...item, productId, addOns: this.filterAllowedAddOns(productId, item.addOns) } : item,
      ),
    }));
  }

  protected updateFixedBundleItemQuantity(itemIndex: number, quantity: number): void {
    this.fixedBundle.update((state) => ({
      ...state,
      items: state.items.map((item, idx) =>
        idx === itemIndex ? { ...item, quantity: Number(quantity) || 1 } : item,
      ),
    }));
  }

  protected getBundleItemQuantityDraft(productId: string, quantity: number): string {
    return this.bundleItemQuantityDraft()[productId] ?? String(quantity);
  }

  protected onBundleItemQuantityDraftInput(productId: string, value: string): void {
    this.bundleItemQuantityDraft.update((state) => ({ ...state, [productId]: value }));
  }

  protected saveBundleItemQuantity(itemIndex: number, productId: string): void {
    const raw = this.bundleItemQuantityDraft()[productId];
    const parsed = Number(raw);
    const nextQuantity = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
    this.updateFixedBundleItemQuantity(itemIndex, nextQuantity);
    this.bundleItemQuantityDraft.update((state) => ({ ...state, [productId]: String(nextQuantity) }));
  }

  protected resetBundleItemQuantity(itemIndex: number, productId: string): void {
    this.updateFixedBundleItemQuantity(itemIndex, 1);
    this.bundleItemQuantityDraft.update((state) => ({ ...state, [productId]: '1' }));
  }

  protected addFixedBundleItemAddOn(itemIndex: number): void {
    const item = this.fixedBundle().items[itemIndex];
    if (!item?.productId) {
      this.alertService.error('Select a bundle product first.');
      return;
    }

    this.fixedBundle.update((state) => ({
      ...state,
      items: state.items.map((item, idx) =>
        idx === itemIndex
          ? { ...item, addOns: [...item.addOns, { addOnProductId: '', quantity: 1 }] }
          : item,
      ),
    }));
  }

  protected removeFixedBundleItemAddOn(itemIndex: number, addOnIndex: number): void {
    this.fixedBundle.update((state) => ({
      ...state,
      items: state.items.map((item, idx) =>
        idx === itemIndex
          ? { ...item, addOns: item.addOns.filter((_, i) => i !== addOnIndex) }
          : item,
      ),
    }));
  }

  protected updateFixedBundleItemAddOnProduct(itemIndex: number, addOnIndex: number, addOnProductId: string): void {
    this.fixedBundle.update((state) => ({
      ...state,
      items: state.items.map((item, idx) =>
        idx === itemIndex
          ? {
              ...item,
              addOns: item.addOns.map((addOn, aIdx) =>
                aIdx === addOnIndex ? { ...addOn, addOnProductId } : addOn,
              ),
            }
          : item,
      ),
    }));
  }

  protected updateFixedBundleItemAddOnQuantity(itemIndex: number, addOnIndex: number, quantity: number): void {
    this.fixedBundle.update((state) => ({
      ...state,
      items: state.items.map((item, idx) =>
        idx === itemIndex
          ? {
              ...item,
              addOns: item.addOns.map((addOn, aIdx) =>
                aIdx === addOnIndex ? { ...addOn, quantity: Number(quantity) || 1 } : addOn,
              ),
            }
          : item,
      ),
    }));
  }

  protected getAllowedAddOnsForFixedBundleItem(itemIndex: number): ProductDto[] {
    const productId = this.fixedBundle().items[itemIndex]?.productId;
    return productId ? this.allowedAddOnsByProductId()[productId] ?? [] : [];
  }

  protected setMixMatchName(value: string): void {
    this.mixMatch.update((state) => ({ ...state, name: value }));
  }

  protected setMixMatchStartAtUtc(value: string): void {
    this.mixMatch.update((state) => ({ ...state, startDate: this.localInputToUtc(value) }));
  }

  protected setMixMatchEndAtUtc(value: string): void {
    this.mixMatch.update((state) => ({ ...state, endDate: this.localInputToUtc(value) }));
  }

  protected setMixMatchIsActive(value: boolean): void {
    this.mixMatch.update((state) => ({ ...state, isActive: value }));
  }

  protected setMixMatchRequiredQuantity(value: number): void {
    this.mixMatch.update((state) => ({ ...state, requiredQuantity: Number(value) || 1 }));
  }

  protected setMixMatchMaxSelectionsPerOrder(value: number | null): void {
    this.mixMatch.update((state) => ({ ...state, maxSelectionsPerOrder: value }));
  }

  protected setMixMatchBundlePrice(value: number): void {
    this.mixMatch.update((state) => ({ ...state, bundlePrice: Number(value) || 0 }));
  }

  protected removeMixMatchItem(index: number): void {
    this.mixMatch.update((value) => ({
      ...value,
      items: value.items.filter((_, i) => i !== index),
    }));
  }

  protected save(): void {
    if (this.isSaving()) {
      return;
    }

    if (!this.validateBeforeSave()) {
      return;
    }

    this.isSaving.set(true);
    if (this.type() === 'mix-match') {
      this.saveMixMatch();
      return;
    }

    this.saveFixedBundle();
  }

  protected cancel(): void {
    if (this.isEditMode() && this.promotionId) {
      this.router.navigate(this.buildDetailsRoute(this.promotionId, this.type()));
      return;
    }

    this.router.navigate(['/management/promotions']);
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.hasEditorChanged()) {
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

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
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
    reader.onload = (e) => this.imagePreview.set((e.target?.result as string) ?? null);
    reader.readAsDataURL(file);
  }

  protected removeImage(): void {
    this.selectedFile.set(null);
    this.imagePreview.set(null);
    const desktopFileInput = document.getElementById('promotionImage') as HTMLInputElement | null;
    const mobileFileInput = document.getElementById('promotionImageMobile') as HTMLInputElement | null;
    if (desktopFileInput) {
      desktopFileInput.value = '';
    }
    if (mobileFileInput) {
      mobileFileInput.value = '';
    }
  }

  protected removeCurrentImage(): void {
    if (!this.promotionId || !this.currentImageUrl() || this.isDeletingImage()) {
      return;
    }

    this.isDeletingImage.set(true);
    this.promotionService.deletePromotionImage(this.promotionId).subscribe({
      next: () => {
        this.currentImageUrl.set(null);
        this.isDeletingImage.set(false);
        this.alertService.successDeleted('Image');
      },
      error: (err: Error) => {
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
    reader.onload = (e) => this.imagePreview.set((e.target?.result as string) ?? null);
    reader.readAsDataURL(file);
  }

  private saveFixedBundle(): void {
    const payload = this.fixedBundle();
    if (this.promotionId) {
      this.promotionService.updateFixedBundle({ id: this.promotionId, ...payload }).subscribe({
        next: (saved) => this.onPromotionSaved(saved.id, saved.imageUrl ?? null, 'Fixed bundle updated.'),
        error: (err: Error) => this.onSaveError(err),
      });
      return;
    }

    this.promotionService.createFixedBundle(payload).subscribe({
      next: (saved) => this.onPromotionSaved(saved.id, saved.imageUrl ?? null, 'Fixed bundle created.'),
      error: (err: Error) => this.onSaveError(err),
    });
  }

  private saveMixMatch(): void {
    const payload = this.mixMatch();
    if (this.promotionId) {
      this.promotionService.updateMixMatch({ id: this.promotionId, ...payload }).subscribe({
        next: (saved) => this.onPromotionSaved(saved.id, saved.imageUrl ?? null, 'Mix & Match promotion updated.'),
        error: (err: Error) => this.onSaveError(err),
      });
      return;
    }

    this.promotionService.createMixMatch(payload).subscribe({
      next: (saved) => this.onPromotionSaved(saved.id, saved.imageUrl ?? null, 'Mix & Match promotion created.'),
      error: (err: Error) => this.onSaveError(err),
    });
  }

  private onPromotionSaved(promotionId: string, imageUrl: string | null, successMessage: string): void {
    this.promotionId = promotionId;
    this.currentImageUrl.set(imageUrl);

    const file = this.selectedFile();
    if (!file) {
      this.onSaveSuccess(successMessage);
      return;
    }

    this.isUploading.set(true);
    this.promotionService.uploadPromotionImage(promotionId, file).subscribe({
      next: (result) => {
        this.currentImageUrl.set(result.imageUrl ?? null);
        this.selectedFile.set(null);
        this.imagePreview.set(null);
        this.isUploading.set(false);
        this.onSaveSuccess(successMessage);
      },
      error: (err: Error) => {
        this.isUploading.set(false);
        this.onSaveError(err);
      },
    });
  }

  private onSaveSuccess(message: string): void {
    this.isSaving.set(false);
    this.skipGuard = true;
    this.alertService.success(message);
    this.router.navigate(this.buildDetailsRoute(this.promotionId!, this.type()));
  }

  private onSaveError(err: Error): void {
    this.isSaving.set(false);
    this.alertService.error(err.message);
  }

  private snapshotEditorState(): void {
    this.initialEditorSnapshot = this.serializeEditorState();
  }

  private hasEditorChanged(): boolean {
    if (!this.initialEditorSnapshot) {
      return this.serializeEditorState() !== '';
    }

    return this.serializeEditorState() !== this.initialEditorSnapshot;
  }

  private serializeEditorState(): string {
    return JSON.stringify({
      type: this.type(),
      fixedBundle: this.fixedBundle(),
      mixMatch: this.mixMatch(),
      currentImageUrl: this.currentImageUrl(),
      hasPendingImage: !!this.selectedFile(),
    });
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  private ensureAllowedAddOnsLoaded(productId: string | null | undefined): void {
    if (!productId) {
      return;
    }

    if (this.allowedAddOnsByProductId()[productId]) {
      return;
    }

    this.productService.getProductAddOns(productId).subscribe({
      next: (groups) => {
        this.allowedAddOnGroupsByProductId.update((map) => ({ ...map, [productId]: groups }));
        this.allowedAddOnsByProductId.update((map) => ({ ...map, [productId]: this.flattenAddOnOptions(groups) }));
      },
      error: () => {
        this.allowedAddOnGroupsByProductId.update((map) => ({ ...map, [productId]: [] }));
        this.allowedAddOnsByProductId.update((map) => ({ ...map, [productId]: [] }));
      },
    });
  }

  private flattenAddOnOptions(groups: AddOnGroupDto[]): ProductDto[] {
    const byId = new Map<string, ProductDto>();
    for (const group of groups) {
      for (const option of group.options) {
        byId.set(option.id, option);
      }
    }

    return [...byId.values()];
  }

  private filterAllowedAddOns<T extends { addOnProductId: string }>(productId: string, addOns: T[]): T[] {
    const allowedIds = new Set((this.allowedAddOnsByProductId()[productId] ?? []).map((x) => x.id));
    return addOns.filter((x) => allowedIds.has(x.addOnProductId));
  }

  private validateBeforeSave(): boolean {
    if (this.type() === 'fixed-bundle') {
      const payload = this.fixedBundle();
      if (!payload.name.trim()) {
        this.alertService.error('Promotion name is required.');
        return false;
      }

      if (payload.items.length === 0) {
        this.alertService.error('At least one bundle item is required.');
        return false;
      }

      for (const item of payload.items) {
        if (!item.productId) {
          this.alertService.error('Each bundle item must have a product.');
          return false;
        }

        const allowedIds = new Set((this.allowedAddOnsByProductId()[item.productId] ?? []).map((x) => x.id));
        if (item.addOns.some((x) => !x.addOnProductId || !allowedIds.has(x.addOnProductId))) {
          this.alertService.error('Bundle add-ons must be linked to the selected bundle item product.');
          return false;
        }
      }

      return true;
    }

    const payload = this.mixMatch();
    if (!payload.name.trim()) {
      this.alertService.error('Promotion name is required.');
      return false;
    }

    if (payload.requiredQuantity <= 0) {
      this.alertService.error('Required quantity must be greater than zero.');
      return false;
    }

    if (payload.bundlePrice < 0) {
      this.alertService.error('Bundle Price must be greater than or equal to zero.');
      return false;
    }

    if (payload.items.length === 0) {
      this.alertService.error('At least one mix & match item is required.');
      return false;
    }

    for (const item of payload.items) {
      if (!item.productId) {
        this.alertService.error('Each mix & match item must have a product.');
        return false;
      }

      const allowedIds = new Set((this.allowedAddOnsByProductId()[item.productId] ?? []).map((x) => x.id));
      if (item.addOns.some((x) => !x.addOnProductId || !allowedIds.has(x.addOnProductId))) {
        this.alertService.error('Mix & match add-ons must be linked to the selected product.');
        return false;
      }
    }

    return true;
  }

  private resolveTypeFromRoute(): PromoEditorType {
    const path = this.route.snapshot.routeConfig?.path ?? '';
    if (path.startsWith('mix-match/')) {
      return 'mix-match';
    }

    if (path.startsWith('fixed-bundles/')) {
      return 'fixed-bundle';
    }

    const queryType = this.route.snapshot.queryParamMap.get('type');
    return queryType === 'mix-match' || queryType === 'mixMatch' ? 'mix-match' : 'fixed-bundle';
  }

  private buildDetailsRoute(id: string, type: PromoEditorType): string[] {
    return type === 'mix-match'
      ? ['/management/promotions/mix-match', id]
      : ['/management/promotions/fixed-bundles', id];
  }

  private utcToLocalInput(utcValue: string | null | undefined): string {
    if (!utcValue) {
      return '';
    }

    const utc = new Date(utcValue);
    if (Number.isNaN(utc.getTime())) {
      return '';
    }

    const local = new Date(utc.getTime() - utc.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  private localInputToUtc(localValue: string | null | undefined): string | null {
    if (!localValue) {
      return null;
    }

    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localValue);
    const local = dateOnlyMatch
      ? new Date(
          Number(dateOnlyMatch[1]),
          Number(dateOnlyMatch[2]) - 1,
          Number(dateOnlyMatch[3]),
          0,
          0,
          0,
          0,
        )
      : new Date(localValue);
    if (Number.isNaN(local.getTime())) {
      return null;
    }

    return local.toISOString();
  }
}


