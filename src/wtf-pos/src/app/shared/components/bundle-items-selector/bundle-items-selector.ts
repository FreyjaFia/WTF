import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, output, signal } from '@angular/core';
import { AlertService, ModalStackService, ProductService } from '@core/services';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { IconComponent } from '@shared/components/icons/icon/icon';
import {
  ADD_ON_TYPE_ORDER,
  AddOnGroupDto,
  AddOnTypeEnum,
  FixedBundleItemAddOnDto,
  ProductDto,
} from '@shared/models';
import { catchError, forkJoin, of } from 'rxjs';
import Sortable from 'sortablejs';

export interface BundleItemSelection {
  productId: string;
  addOns: FixedBundleItemAddOnDto[];
}

@Component({
  selector: 'app-bundle-items-selector',
  imports: [CommonModule, IconComponent, AvatarComponent],
  templateUrl: './bundle-items-selector.html',
  styleUrls: ['./bundle-items-selector.css'],
})
export class BundleItemsSelectorComponent {
  private readonly modalStack = inject(ModalStackService);
  private readonly productService = inject(ProductService);
  private readonly alertService = inject(AlertService);

  private modalStackId: number | null = null;
  private availableSortable: Sortable | null = null;
  private selectedSortable: Sortable | null = null;
  private initialAddOnsByProductId: Record<string, FixedBundleItemAddOnDto[]> = {};

  @ViewChild('availableList') private readonly availableList!: ElementRef;
  @ViewChild('selectedList') private readonly selectedList!: ElementRef;

  protected readonly isOpen = signal(false);
  protected readonly isLoadingAddOns = signal(false);
  protected readonly searchTerm = signal('');
  protected readonly availableProducts = signal<ProductDto[]>([]);
  protected readonly selectedProducts = signal<ProductDto[]>([]);
  protected readonly activeSelectedProductId = signal<string | null>(null);
  protected readonly addOnGroupsByProductId = signal<Record<string, AddOnGroupDto[]>>({});
  protected readonly selectionsByProductId = signal<Record<string, Record<number, Map<string, number>>>>({});

  protected readonly AddOnTypeEnum = AddOnTypeEnum;

  readonly confirmed = output<BundleItemSelection[]>();

  protected readonly filteredAvailableProducts = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    if (!query) {
      return this.availableProducts();
    }

    return this.availableProducts().filter((x) => x.name.toLowerCase().includes(query));
  });

  protected readonly activeProduct = computed(() => {
    const id = this.activeSelectedProductId();
    if (!id) {
      return null;
    }

    return this.selectedProducts().find((x) => x.id === id) ?? null;
  });

  protected readonly activeAddOnGroups = computed(() => {
    const productId = this.activeSelectedProductId();
    if (!productId) {
      return [];
    }

    return this.addOnGroupsByProductId()[productId] ?? [];
  });

  protected readonly activeValidationError = computed(() => {
    const productId = this.activeSelectedProductId();
    if (!productId) {
      return null;
    }

    return this.getValidationErrorForProduct(productId);
  });

  public open(products: ProductDto[], selectedItems: BundleItemSelection[]): void {
    const byId = new Map(products.map((x) => [x.id, x]));
    const selected = selectedItems
      .map((x) => byId.get(x.productId))
      .filter((x): x is ProductDto => !!x);
    const selectedIdSet = new Set(selected.map((x) => x.id));
    const available = products.filter((x) => !selectedIdSet.has(x.id));

    this.initialAddOnsByProductId = {};
    for (const item of selectedItems) {
      this.initialAddOnsByProductId[item.productId] = item.addOns ?? [];
    }

    this.searchTerm.set('');
    this.addOnGroupsByProductId.set({});
    this.selectionsByProductId.set({});
    this.availableProducts.set(this.sortByName(available));
    this.selectedProducts.set(selected);
    this.activeSelectedProductId.set(selected[0]?.id ?? null);
    this.isOpen.set(true);
    this.modalStackId = this.modalStack.push(() => this.close());

    if (selected.length > 0) {
      this.ensureAddOnGroupsLoaded(selected[0].id);
    }

    setTimeout(() => this.initializeSortable(), 100);
  }

  protected close(): void {
    this.destroySortables();
    this.isOpen.set(false);
    this.isLoadingAddOns.set(false);
    this.searchTerm.set('');
    this.availableProducts.set([]);
    this.selectedProducts.set([]);
    this.activeSelectedProductId.set(null);
    this.addOnGroupsByProductId.set({});
    this.selectionsByProductId.set({});
    this.initialAddOnsByProductId = {};

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  protected save(): void {
    const selected = this.selectedProducts();
    const groupsByProductId = this.addOnGroupsByProductId();
    const missingProductIds = selected
      .map((product) => product.id)
      .filter((productId) => !groupsByProductId[productId]);

    if (missingProductIds.length === 0) {
      this.saveAfterValidation();
      return;
    }

    this.isLoadingAddOns.set(true);
    forkJoin(
      missingProductIds.map((productId) =>
        this.productService.getProductAddOns(productId).pipe(catchError(() => of<AddOnGroupDto[]>([]))),
      ),
    ).subscribe({
      next: (groupsByIndex) => {
        for (let i = 0; i < missingProductIds.length; i++) {
          const productId = missingProductIds[i];
          const normalized = this.normalizeAddOnGroups(groupsByIndex[i] ?? []);

          this.addOnGroupsByProductId.update((state) => ({
            ...state,
            [productId]: normalized,
          }));

          this.applyInitialAddOnSelections(productId, normalized);
        }

        this.isLoadingAddOns.set(false);
        this.saveAfterValidation();
      },
      error: () => {
        this.isLoadingAddOns.set(false);
      },
    });
  }

  protected onSearchInput(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  protected setActiveProduct(productId: string): void {
    this.activeSelectedProductId.set(productId);
    this.ensureAddOnGroupsLoaded(productId);
  }

  protected getSelectionRule(type: AddOnTypeEnum): string {
    switch (type) {
      case AddOnTypeEnum.Size:
        return 'Required | Pick one';
      case AddOnTypeEnum.Flavor:
        return 'Required | Pick one';
      case AddOnTypeEnum.Sauce:
        return 'Optional | Pick one';
      case AddOnTypeEnum.Topping:
        return 'Optional | Pick many';
      case AddOnTypeEnum.Extra:
        return 'Optional | Pick many';
      default:
        return '';
    }
  }

  protected getGroupHeader(group: AddOnGroupDto): string {
    switch (group.type) {
      case AddOnTypeEnum.Size:
        return 'Sizes';
      case AddOnTypeEnum.Flavor:
        return 'Flavors';
      case AddOnTypeEnum.Sauce:
        return 'Sauces';
      case AddOnTypeEnum.Topping:
        return 'Toppings';
      case AddOnTypeEnum.Extra:
        return 'Extras';
      default:
        return group.displayName.endsWith('s') ? group.displayName : `${group.displayName}s`;
    }
  }

  protected isRadioGroup(type: AddOnTypeEnum): boolean {
    return (
      type === AddOnTypeEnum.Size || type === AddOnTypeEnum.Flavor || type === AddOnTypeEnum.Sauce
    );
  }

  protected isSelected(productId: string, type: AddOnTypeEnum, optionId: string): boolean {
    const selection = this.selectionsByProductId()[productId];
    return (selection?.[type]?.get(optionId) ?? 0) > 0;
  }

  protected getQuantity(productId: string, type: AddOnTypeEnum, optionId: string): number {
    const selection = this.selectionsByProductId()[productId];
    return selection?.[type]?.get(optionId) ?? 0;
  }

  protected toggleOption(productId: string, group: AddOnGroupDto, option: ProductDto): void {
    if (!option.isActive) {
      return;
    }

    const nextByProduct = { ...this.selectionsByProductId() };
    const currentByType = { ...(nextByProduct[productId] ?? {}) };
    const type = group.type;

    if (this.isRadioGroup(type)) {
      const current = currentByType[type];
      const currentQty = current?.get(option.id) ?? 0;

      if (currentQty > 0) {
        if (type === AddOnTypeEnum.Sauce) {
          currentByType[type] = new Map<string, number>();
        }
      } else {
        currentByType[type] = new Map<string, number>([[option.id, 1]]);
      }
    } else {
      const current = currentByType[type] ?? new Map<string, number>();
      const next = new Map(current);
      const qty = next.get(option.id) ?? 0;

      if (qty > 0) {
        next.delete(option.id);
      } else {
        next.set(option.id, 1);
      }

      currentByType[type] = next;
    }

    nextByProduct[productId] = currentByType;
    this.selectionsByProductId.set(nextByProduct);
  }

  protected incrementOption(
    productId: string,
    group: AddOnGroupDto,
    option: ProductDto,
    event: Event,
  ): void {
    event.stopPropagation();

    if (!option.isActive) {
      return;
    }

    const nextByProduct = { ...this.selectionsByProductId() };
    const currentByType = { ...(nextByProduct[productId] ?? {}) };
    const type = group.type;
    const current = currentByType[type] ?? new Map<string, number>();
    const next = new Map(current);

    next.set(option.id, (next.get(option.id) ?? 0) + 1);
    currentByType[type] = next;
    nextByProduct[productId] = currentByType;
    this.selectionsByProductId.set(nextByProduct);
  }

  protected decrementOption(
    productId: string,
    group: AddOnGroupDto,
    option: ProductDto,
    event: Event,
  ): void {
    event.stopPropagation();

    const nextByProduct = { ...this.selectionsByProductId() };
    const currentByType = { ...(nextByProduct[productId] ?? {}) };
    const type = group.type;
    const current = currentByType[type] ?? new Map<string, number>();
    const next = new Map(current);
    const qty = next.get(option.id) ?? 0;

    if (qty <= 1) {
      next.delete(option.id);
    } else {
      next.set(option.id, qty - 1);
    }

    currentByType[type] = next;
    nextByProduct[productId] = currentByType;
    this.selectionsByProductId.set(nextByProduct);
  }

  protected getSelectedAddOnCount(productId: string): number {
    return this.flattenSelections(productId).length;
  }

  private initializeSortable(): void {
    if (!this.availableList || !this.selectedList) {
      return;
    }

    this.destroySortables();

    const options = {
      group: 'bundle-items',
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'opacity-50',
      dragClass: '!rounded-none',
      onEnd: () => this.syncWithDom(),
    };

    this.availableSortable = new Sortable(this.availableList.nativeElement, options);
    this.selectedSortable = new Sortable(this.selectedList.nativeElement, options);
  }

  private destroySortables(): void {
    this.availableSortable?.destroy();
    this.selectedSortable?.destroy();
    this.availableSortable = null;
    this.selectedSortable = null;
  }

  private syncWithDom(): void {
    const selectedIds = Array.from(this.selectedList.nativeElement.querySelectorAll('[data-id]')).map(
      (x) => (x as HTMLElement).getAttribute('data-id') || '',
    );
    const selectedIdSet = new Set(selectedIds);

    const all = [...this.availableProducts(), ...this.selectedProducts()];
    const byId = new Map(all.map((x) => [x.id, x]));
    const nextSelected = selectedIds.map((id) => byId.get(id)).filter((x): x is ProductDto => !!x);

    this.selectedProducts.set(nextSelected);
    this.availableProducts.set(this.sortByName(all.filter((x) => !selectedIdSet.has(x.id))));

    const activeId = this.activeSelectedProductId();
    if (!activeId || !selectedIdSet.has(activeId)) {
      const nextActive = nextSelected[0]?.id ?? null;
      this.activeSelectedProductId.set(nextActive);
      if (nextActive) {
        this.ensureAddOnGroupsLoaded(nextActive);
      }
      return;
    }

    this.ensureAddOnGroupsLoaded(activeId);
  }

  private ensureAddOnGroupsLoaded(productId: string): void {
    if (!productId) {
      return;
    }

    if (this.addOnGroupsByProductId()[productId]) {
      return;
    }

    this.isLoadingAddOns.set(true);
    this.productService.getProductAddOns(productId).subscribe({
      next: (groups) => {
        const normalized = this.normalizeAddOnGroups(groups);

        this.addOnGroupsByProductId.update((state) => ({
          ...state,
          [productId]: normalized,
        }));

        this.applyInitialAddOnSelections(productId, normalized);
        this.isLoadingAddOns.set(false);
      },
      error: () => {
        this.addOnGroupsByProductId.update((state) => ({
          ...state,
          [productId]: [],
        }));
        this.selectionsByProductId.update((state) => ({
          ...state,
          [productId]: {},
        }));
        this.isLoadingAddOns.set(false);
      },
    });
  }

  private normalizeAddOnGroups(groups: AddOnGroupDto[]): AddOnGroupDto[] {
    return groups
      .sort((a, b) => ADD_ON_TYPE_ORDER[a.type] - ADD_ON_TYPE_ORDER[b.type])
      .map((group) => ({
        ...group,
        options: group.options
          .filter((opt, i, arr) => arr.findIndex((x) => x.id === opt.id) === i)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }

  private saveAfterValidation(): void {
    const validationError = this.getFirstValidationError();
    if (validationError) {
      this.alertService.error(validationError);
      return;
    }

    const result: BundleItemSelection[] = this.selectedProducts().map((product) => ({
      productId: product.id,
      addOns: this.flattenSelections(product.id),
    }));

    this.confirmed.emit(result);
    this.close();
  }

  private applyInitialAddOnSelections(productId: string, groups: AddOnGroupDto[]): void {
    if (this.selectionsByProductId()[productId]) {
      return;
    }

    const addOns = this.initialAddOnsByProductId[productId] ?? [];
    if (addOns.length === 0) {
      this.selectionsByProductId.update((state) => ({
        ...state,
        [productId]: {},
      }));
      return;
    }

    const optionTypeById = new Map(
      groups.flatMap((group) => group.options.map((option) => [option.id, group.type] as const)),
    );
    const byType: Record<number, Map<string, number>> = {};

    for (const addOn of addOns) {
      const type = optionTypeById.get(addOn.addOnProductId);
      if (!type) {
        continue;
      }

      const current = byType[type] ?? new Map<string, number>();
      current.set(addOn.addOnProductId, (current.get(addOn.addOnProductId) ?? 0) + (addOn.quantity || 1));
      byType[type] = current;
    }

    this.selectionsByProductId.update((state) => ({
      ...state,
      [productId]: byType,
    }));
  }

  private flattenSelections(productId: string): FixedBundleItemAddOnDto[] {
    const groups = this.addOnGroupsByProductId()[productId] ?? [];
    const selection = this.selectionsByProductId()[productId] ?? {};
    const result: FixedBundleItemAddOnDto[] = [];

    for (const group of groups) {
      const selected = selection[group.type];
      if (!selected) {
        continue;
      }

      for (const option of group.options) {
        const quantity = selected.get(option.id) ?? 0;
        if (quantity <= 0) {
          continue;
        }

        result.push({
          addOnProductId: option.id,
          quantity,
        });
      }
    }

    return result;
  }

  private getValidationErrorForProduct(productId: string): string | null {
    const groups = this.addOnGroupsByProductId()[productId] ?? [];
    const selection = this.selectionsByProductId()[productId] ?? {};

    for (const group of groups) {
      const selected = selection[group.type];
      const totalSelected = selected ? Array.from(selected.values()).reduce((sum, x) => sum + x, 0) : 0;
      const activeOptions = group.options.filter((x) => x.isActive);

      if (
        (group.type === AddOnTypeEnum.Size || group.type === AddOnTypeEnum.Flavor) &&
        activeOptions.length > 0 &&
        totalSelected !== 1
      ) {
        return `${this.getProductLabel(productId)} requires exactly one ${group.type === AddOnTypeEnum.Size ? 'size' : 'flavor'}.`;
      }

      if (group.type === AddOnTypeEnum.Sauce && totalSelected > 1) {
        return `${this.getProductLabel(productId)} allows only one sauce.`;
      }
    }

    return null;
  }

  private getFirstValidationError(): string | null {
    for (const product of this.selectedProducts()) {
      const error = this.getValidationErrorForProduct(product.id);
      if (error) {
        this.activeSelectedProductId.set(product.id);
        return error;
      }
    }

    return null;
  }

  private getProductLabel(productId: string): string {
    return this.selectedProducts().find((x) => x.id === productId)?.name ?? 'Selected item';
  }

  private sortByName<T extends { name: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
}
