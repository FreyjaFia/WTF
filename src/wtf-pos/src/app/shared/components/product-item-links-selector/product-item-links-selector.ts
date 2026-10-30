import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, output, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService, InventoryService, ModalStackService, ProductService } from '@core/services';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { effectiveQuantity, salesCovered } from '@shared/calculations';
import { getInventoryUnitAbbreviation } from '@shared/constants/inventory-units';
import {
  ItemDto,
  ProductDto,
  ProductItemLinkAssignmentDto,
  ProductItemLinkDto,
} from '@shared/models';
import Sortable from 'sortablejs';

interface LinkedProductRow {
  productId: string;
  name: string;
  code: string;
  price: number;
  imageUrl?: string | null;
  isAddOn: boolean;
  isActive: boolean;
  quantityPerSale: number;
  allowancePercent: number;
}

@Component({
  selector: 'app-product-item-links-selector',
  imports: [CommonModule, FormsModule, IconComponent, AvatarComponent],
  templateUrl: './product-item-links-selector.html',
})
export class ProductItemLinksSelectorComponent {
  private readonly modalStack = inject(ModalStackService);
  private readonly productService = inject(ProductService);
  private readonly inventoryService = inject(InventoryService);
  private readonly alertService = inject(AlertService);

  private modalStackId: number | null = null;
  private availableSortable: Sortable | null = null;
  private assignedSortable: Sortable | null = null;
  private itemId = '';
  private initialLinks: ProductItemLinkDto[] = [];
  private rememberedQuantities = new Map<string, number>();
  private rememberedAllowances = new Map<string, number>();

  @ViewChild('availableList') private readonly availableList!: ElementRef;
  @ViewChild('assignedList') private readonly assignedList!: ElementRef;

  public readonly saved = output<ItemDto>();

  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly allProducts = signal<ProductDto[]>([]);
  protected readonly availableProducts = signal<ProductDto[]>([]);
  protected readonly linkedProducts = signal<LinkedProductRow[]>([]);
  protected readonly searchTerm = signal('');
  protected readonly selectedFilter = signal<'all' | 'products' | 'addons'>('all');
  protected readonly unitName = signal('');
  protected readonly currentQuantity = signal(0);
  protected readonly unitAbbreviation = computed(() =>
    getInventoryUnitAbbreviation(this.unitName()),
  );

  public open(
    itemId: string,
    currentLinks: ProductItemLinkDto[],
    unitName: string,
    currentQuantity = 0,
  ): void {
    this.itemId = itemId;
    this.unitName.set(unitName);
    this.currentQuantity.set(currentQuantity);
    this.initialLinks = currentLinks.filter((link) => link.isActive);
    this.rememberedQuantities = new Map(
      currentLinks.filter((link) => !link.isActive).map((link) => [link.productId, link.quantityPerSale]),
    );
    this.rememberedAllowances = new Map(
      currentLinks.filter((link) => !link.isActive).map((link) => [link.productId, link.allowancePercent ?? 0]),
    );
    this.searchTerm.set('');
    this.selectedFilter.set('all');
    this.allProducts.set([]);
    this.availableProducts.set([]);
    this.linkedProducts.set([]);
    this.loadProducts();
  }

  public registerOnStack(): void {
    this.modalStackId = this.modalStack.push(() => this.closeModal());
  }

  protected closeModal(): void {
    if (this.isSaving()) {
      return;
    }

    this.destroySortables();
    this.availableProducts.set([]);
    this.linkedProducts.set([]);
    this.searchTerm.set('');
    this.selectedFilter.set('all');
    this.isLoading.set(false);
    this.isSaving.set(false);
    this.itemId = '';
    this.initialLinks = [];
    this.rememberedQuantities = new Map();
    this.rememberedAllowances = new Map();
    this.allProducts.set([]);
    this.unitName.set('');
    this.currentQuantity.set(0);

    const modal = document.querySelector('#product-item-links-modal') as HTMLDialogElement;
    if (modal) {
      modal.close();
    }

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  protected stockImpact(row: LinkedProductRow): string {
    const unit = this.unitAbbreviation();
    const perSale = effectiveQuantity(row.quantityPerSale, row.allowancePercent);
    const covered = salesCovered(this.currentQuantity(), perSale);
    const sales = covered === 1 ? '1 sale' : `${covered} sales`;

    return covered > 0
      ? `1 sale takes ${perSale} ${unit}. In stock now: enough for ${sales}.`
      : `1 sale takes ${perSale} ${unit}. In stock now: not enough for one sale.`;
  }

  protected onSearchInput(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  protected onFilterChange(event: Event): void {
    this.selectedFilter.set((event.target as HTMLSelectElement).value as 'all' | 'products' | 'addons');
  }

  protected get filteredAvailableProducts(): ProductDto[] {
    const term = this.searchTerm().trim().toLowerCase();
    const filter = this.selectedFilter();
    const linkedIds = new Set(this.linkedProducts().map((link) => link.productId));

    return this.availableProducts()
      .filter((product) => !linkedIds.has(product.id))
      .filter((product) => {
        if (filter === 'products') {
          return !product.isAddOn;
        }

        if (filter === 'addons') {
          return product.isAddOn;
        }

        return true;
      })
      .filter((product) => {
        if (!term) {
          return true;
        }

        return (
          product.name.toLowerCase().includes(term) ||
          product.code.toLowerCase().includes(term)
        );
      });
  }

  protected onQuantityChange(productId: string, value: string | number): void {
    const quantity = Number(value);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }

    this.linkedProducts.set(
      this.linkedProducts().map((row) =>
        row.productId === productId ? { ...row, quantityPerSale: quantity } : row,
      ),
    );
  }

  protected onAllowanceChange(productId: string, value: string | number | null): void {
    const parsed = value === null || value === '' ? 0 : Number(value);
    const allowance = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;

    this.linkedProducts.set(
      this.linkedProducts().map((row) =>
        row.productId === productId ? { ...row, allowancePercent: allowance } : row,
      ),
    );
  }

  protected removeLinkedProduct(productId: string): void {
    const removed = this.linkedProducts().find((row) => row.productId === productId);
    if (removed) {
      this.rememberedQuantities.set(productId, removed.quantityPerSale);
      this.rememberedAllowances.set(productId, removed.allowancePercent);
    }
    this.linkedProducts.set(this.linkedProducts().filter((row) => row.productId !== productId));

    if (!removed) {
      return;
    }

    const product = this.allProducts().find((row) => row.id === productId);
    if (product && product.isActive) {
      const nextAvailable = [...this.availableProducts(), product];
      this.availableProducts.set(this.sortByName(nextAvailable));
    }
  }

  protected getSelectedCount(): number {
    return this.linkedProducts().length;
  }

  protected save(): void {
    if (!this.itemId) {
      return;
    }

    const validationError = this.validateSelection();
    if (validationError) {
      this.alertService.error(validationError);
      return;
    }

    this.isSaving.set(true);

    const productLinks: ProductItemLinkAssignmentDto[] = this.linkedProducts().map((row) => ({
      productId: row.productId,
      quantityPerSale: row.quantityPerSale,
      allowancePercent: row.allowancePercent,
      isActive: true,
    }));

    this.inventoryService.assignProductItemLinks(this.itemId, productLinks).subscribe({
      next: (item) => {
        this.isSaving.set(false);
        this.alertService.successSaved('Product links');
        this.saved.emit(item);
        this.closeModal();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  private loadProducts(): void {
    this.isLoading.set(true);

    this.productService.getProducts().subscribe({
      next: (products) => {
        const productById = new Map(products.map((product) => [product.id, product]));

        const linked = this.initialLinks.map<LinkedProductRow>((link) => {
          const product = productById.get(link.productId);
          return {
            productId: link.productId,
            name: product?.name ?? link.productName,
            code: product?.code ?? link.productCode,
            price: product?.price ?? 0,
            imageUrl: product?.imageUrl ?? null,
            isAddOn: product?.isAddOn ?? false,
            isActive: product?.isActive ?? link.isActive,
            quantityPerSale: link.quantityPerSale,
            allowancePercent: link.allowancePercent ?? 0,
          };
        });

        const linkedIds = new Set(linked.map((row) => row.productId));
        const available = products.filter((product) => !linkedIds.has(product.id) && product.isActive);

        this.allProducts.set(products);
        this.availableProducts.set(this.sortByName(available));
        this.linkedProducts.set(this.sortByName(linked));
        this.isLoading.set(false);

        this.initializeSortable();
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  private initializeSortable(): void {
    setTimeout(() => {
      if (!this.availableList || !this.assignedList) {
        return;
      }

      this.destroySortables();

      const options = {
        group: 'product-item-links',
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'opacity-50',
        dragClass: '!rounded-none',
        onEnd: () => this.syncSignalsWithDOM(),
      };

      this.availableSortable = new Sortable(this.availableList.nativeElement, options);
      this.assignedSortable = new Sortable(this.assignedList.nativeElement, options);
    }, 100);
  }

  private destroySortables(): void {
    this.availableSortable?.destroy();
    this.assignedSortable?.destroy();
    this.availableSortable = null;
    this.assignedSortable = null;
  }

  private syncSignalsWithDOM(): void {
    if (!this.availableList || !this.assignedList) {
      return;
    }

    const selectedIds = Array.from(this.assignedList.nativeElement.querySelectorAll('[data-id]')).map(
      (element) => (element as HTMLElement).getAttribute('data-id') || '',
    );
    const selectedIdSet = new Set(selectedIds);

    const existingQuantities = new Map(this.linkedProducts().map((row) => [row.productId, row.quantityPerSale]));
    const existingAllowances = new Map(this.linkedProducts().map((row) => [row.productId, row.allowancePercent]));
    const selectedRowById = new Map(this.linkedProducts().map((row) => [row.productId, row]));
    const productById = new Map<string, Pick<ProductDto, 'id' | 'name' | 'code' | 'price' | 'imageUrl' | 'isAddOn' | 'isActive'>>();

    for (const product of this.allProducts()) {
      productById.set(product.id, product);
    }

    for (const row of this.linkedProducts()) {
      productById.set(row.productId, {
        id: row.productId,
        name: row.name,
        code: row.code,
        price: row.price,
        imageUrl: row.imageUrl ?? null,
        isAddOn: row.isAddOn,
        isActive: row.isActive,
      });
    }

    const nextLinked = selectedIds
      .map((id) => {
        const row = selectedRowById.get(id);
        const product = productById.get(id);

        if (row) {
          return {
            ...row,
            quantityPerSale: existingQuantities.get(id) ?? row.quantityPerSale,
            allowancePercent: existingAllowances.get(id) ?? row.allowancePercent,
          };
        }

        if (!product) {
          return null;
        }

        return {
          productId: product.id,
          name: product.name,
          code: product.code,
          price: product.price,
          imageUrl: product.imageUrl ?? null,
          isAddOn: product.isAddOn,
          isActive: product.isActive,
          quantityPerSale:
            existingQuantities.get(product.id) ?? this.rememberedQuantities.get(product.id) ?? 1,
          allowancePercent: this.rememberedAllowances.get(product.id) ?? 0,
        };
      })
      .filter((row): row is LinkedProductRow => !!row);

    this.linkedProducts.set(nextLinked);

    const available = this.allProducts().filter(
      (product) => product.isActive && !selectedIdSet.has(product.id),
    );
    this.availableProducts.set(this.sortByName(available));
  }

  private validateSelection(): string | null {
    const duplicates = this.linkedProducts()
      .map((row) => row.productId)
      .filter((id, index, array) => array.indexOf(id) !== index);

    if (duplicates.length > 0) {
      return 'Duplicate product links are not allowed.';
    }

    if (this.linkedProducts().some((row) => row.quantityPerSale <= 0)) {
      return 'Quantity per sale must be greater than zero.';
    }

    if (this.linkedProducts().some((row) => row.allowancePercent < 0 || row.allowancePercent > 100)) {
      return 'Allowance must be between 0 and 100 percent.';
    }

    return null;
  }

  private sortByName<T extends { name: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
}
