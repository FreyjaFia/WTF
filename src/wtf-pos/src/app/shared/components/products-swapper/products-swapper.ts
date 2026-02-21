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
import { AlertService, ProductService } from '@core/services';
import { Icon } from '@shared/components/icons/icon/icon';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { AddOnTypeEnum, ProductCategoryEnum, ProductDto } from '@shared/models';
import Sortable from 'sortablejs';

@Component({
  selector: 'app-products-swapper',
  imports: [CommonModule, Icon, AvatarComponent],
  templateUrl: './products-swapper.html',
  styleUrls: ['./products-swapper.css'],
})
export class ProductsSwapperComponent implements AfterViewInit {
  private readonly productService = inject(ProductService);
  private readonly alertService = inject(AlertService);

  @ViewChild('availableList') private availableList!: ElementRef;
  @ViewChild('assignedList') private assignedList!: ElementRef;

  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly availableProducts = signal<ProductDto[]>([]);
  protected readonly linkedProducts = signal<(ProductDto & { type: AddOnTypeEnum })[]>([]);
  protected readonly searchTerm = signal('');
  protected readonly selectedCategory = signal<ProductCategoryEnum | null>(null);

  protected readonly AddOnTypeEnum = AddOnTypeEnum;

  protected readonly addOnTypeOptions = [
    { value: AddOnTypeEnum.Size, label: 'Size' },
    { value: AddOnTypeEnum.Flavor, label: 'Flavor' },
    { value: AddOnTypeEnum.Topping, label: 'Topping' },
    { value: AddOnTypeEnum.Extra, label: 'Extra' },
    { value: AddOnTypeEnum.Sauce, label: 'Sauce' },
  ];

  protected readonly categoryOptions = [
    { value: ProductCategoryEnum.Drink, label: 'Drink' },
    { value: ProductCategoryEnum.Food, label: 'Food' },
    { value: ProductCategoryEnum.Dessert, label: 'Dessert' },
    { value: ProductCategoryEnum.Other, label: 'Other' },
  ];

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
  public addOnType = AddOnTypeEnum.Size; // Default type

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
              .map((addon) => ({ ...addon, type: AddOnTypeEnum.Size })); // Default type for available

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
    this.availableProducts.set(
      this.sortByName(allProducts.filter((p) => !linkedIdsSet.has(p.id))),
    );

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
    const modal = document.querySelector('#products-swapper-modal') as HTMLDialogElement;

    if (modal) {
      modal.close();
    }
  }

  protected onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchTerm.set(input.value);
  }

  protected onCategoryChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    this.selectedCategory.set(value ? (Number(value) as ProductCategoryEnum) : null);
  }

  protected changeProductType(productId: string, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newType = Number(select.value) as AddOnTypeEnum;

    this.linkedProducts.set(
      this.linkedProducts().map((p) => (p.id === productId ? { ...p, type: newType } : p)),
    );
  }

  private sortByName<T extends { name: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
}
