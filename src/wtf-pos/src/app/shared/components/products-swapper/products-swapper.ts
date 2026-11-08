import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { AlertService, CatalogLookupService, ModalStackService, ProductService } from '@core/services';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ProductDto, SYSTEM_CATALOG_IDS } from '@shared/models';
import Sortable from 'sortablejs';

@Component({
  selector: 'app-products-swapper',
  imports: [CommonModule, IconComponent, AvatarComponent],
  templateUrl: './products-swapper.html',
  styleUrls: ['./products-swapper.css'],
})
export class ProductsSwapperComponent implements AfterViewInit {
  private readonly modalStack = inject(ModalStackService);
  private readonly productService = inject(ProductService);
  private readonly alertService = inject(AlertService);
  private readonly lookups = inject(CatalogLookupService);

  private modalStackId: number | null = null;

  @ViewChild('availableList') private availableList!: ElementRef;
  @ViewChild('assignedList') private assignedList!: ElementRef;

  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly availableProducts = signal<ProductDto[]>([]);
  protected readonly linkedProducts = signal<(ProductDto & { type: number })[]>([]);
  protected readonly searchTerm = signal('');
  protected readonly selectedCategory = signal<number | null>(null);

  protected readonly addOnTypeOptions = computed(() =>
    this.lookups.activeAddOnTypes().map((type) => ({ value: type.id, label: type.name })),
  );

  protected readonly categoryOptions = computed(() =>
    this.lookups.activeCategories().map((category) => ({ value: category.id, label: category.name })),
  );

  protected readonly filteredAvailableProducts = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const category = this.selectedCategory();
    let products = this.availableProducts();

    if (category !== null) {
      products = products.filter((product) => product.category === category);
    }

    if (!term) {
      return products;
    }

    return products.filter((product) => product.name.toLowerCase().includes(term));
  });

  public addOnId = '';
  public addOnType: number = SYSTEM_CATALOG_IDS.sizeAddOnType; // Default type

  public ngAfterViewInit(): void {
    if (this.addOnId) {
      this.loadProducts();
    }
  }

  private loadProducts(): void {
    this.isLoading.set(true);

    // Load all non-add-on active products
    this.productService.getProducts({ isAddOn: false, isActive: true }).subscribe({
      next: (allProducts) => {
        // Get the currently linked products for this add-on
        this.productService.getLinkedProducts(this.addOnId).subscribe({
          next: (linkedProductsGroup) => {
            // Flatten the groups into a list with type info
            const assignedFlat = linkedProductsGroup.flatMap((group) =>
              group.options.map((option) => ({ ...option, type: group.type })),
            );

            const linkedIds = new Set(assignedFlat.map((p) => p.id));

            // Split: available (not linked) on left, linked on right
            const availableNotLinked = allProducts
              .filter((addon) => !linkedIds.has(addon.id))
              .map((addon) => ({ ...addon, type: SYSTEM_CATALOG_IDS.sizeAddOnType })); // Default type for available

            this.availableProducts.set(this.sortByName(availableNotLinked));
            this.linkedProducts.set(this.sortByName(assignedFlat));
            this.isLoading.set(false);

            // Initialize Sortable after data is loaded and DOM is populated
            this.initializeSortable();
          },
          error: () => {
            this.isLoading.set(false);
          },
        });
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  private initializeSortable(): void {
    setTimeout(() => {
      if (!this.availableList || !this.assignedList) {
        return;
      }

      const options = {
        group: 'products-swap',
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'opacity-50',
        dragClass: '!rounded-none',
        onEnd: () => {
          this.syncSignalsWithDOM();
        },
      };

      new Sortable(this.availableList.nativeElement, options);
      new Sortable(this.assignedList.nativeElement, options);
    }, 100);
  }

  private syncSignalsWithDOM(): void {
    if (!this.availableList || !this.assignedList) {
      return;
    }

    // Get all item IDs currently in the assigned list DOM
    const linkedIdsArray = Array.from(
      this.assignedList.nativeElement.querySelectorAll('[data-id]'),
    ).map((el) => (el as HTMLElement).getAttribute('data-id') || '');
    const linkedIdsSet = new Set(linkedIdsArray);

    // Build a lookup of all known products
    const allProducts = [...this.availableProducts(), ...this.linkedProducts()];
    const productById = new Map(allProducts.map((p) => [p.id, p]));

    // Preserve existing type selections
    const existingTypes = new Map(this.linkedProducts().map((p) => [p.id, p.type]));

    // Available = everything not linked (includes filtered-out items)
    this.availableProducts.set(this.sortByName(allProducts.filter((p) => !linkedIdsSet.has(p.id))));

    // Linked = items in the assigned DOM, preserving order
    this.linkedProducts.set(
      linkedIdsArray
        .map((id) => productById.get(id))
        .filter((p): p is ProductDto => !!p)
        .map((p) => ({ ...p, type: existingTypes.get(p.id) ?? this.addOnType })),
    );
  }

  protected saveProducts(): void {
    if (!this.assignedList) {
      return;
    }

    // Get the current linked products with their type info
    const products = this.linkedProducts().map((product) => ({
      productId: product.id,
      addOnType: product.type,
    }));

    this.isSaving.set(true);

    this.productService.assignLinkedProducts(this.addOnId, products).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.alertService.successSaved('Linked products');
        this.closeModal();
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isSaving.set(false);
      },
    });
  }

  protected closeModal(): void {
    if (this.isSaving()) {
      return;
    }

    const modal = document.querySelector('#products-swapper-modal') as HTMLDialogElement;

    if (modal) {
      modal.close();
    }

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  public registerOnStack(): void {
    this.modalStackId = this.modalStack.push(() => this.closeModal());
  }

  protected onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchTerm.set(input.value);
  }

  protected onCategoryChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    this.selectedCategory.set(value ? (Number(value) as number) : null);
  }

  protected changeProductType(productId: string, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newType = Number(select.value) as number;

    this.linkedProducts.set(
      this.linkedProducts().map((p) => (p.id === productId ? { ...p, type: newType } : p)),
    );
  }

  private sortByName<T extends { name: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
}
