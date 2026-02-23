import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, ModalStackService, ProductService } from '@core/services';
import {
  AvatarComponent,
  BadgeComponent,
  Icon,
  PriceHistoryDrawerComponent,
} from '@shared/components';
import {
  ADD_ON_TYPE_ORDER,
  AddOnGroupDto,
  ProductCategoryEnum,
  ProductDto,
  ProductPriceHistoryDto,
} from '@shared/models';

@Component({
  selector: 'app-product-details',
  imports: [
    CommonModule,
    RouterLink,
    Icon,
    BadgeComponent,
    PriceHistoryDrawerComponent,
    AvatarComponent,
  ],
  templateUrl: './product-details.html',
  host: {
    class: 'block h-full',
  },
})
export class ProductDetailsComponent implements OnInit {
  private readonly productService = inject(ProductService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly modalStack = inject(ModalStackService);

  protected readonly product = signal<ProductDto | null>(null);
  protected readonly addOns = signal<AddOnGroupDto[]>([]);
  protected readonly linkedProducts = signal<AddOnGroupDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isHistoryOpen = signal(false);
  protected readonly priceHistory = signal<ProductPriceHistoryDto[]>([]);
  protected readonly showAllAddOns = signal(false);
  protected readonly showAllLinked = signal(false);
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
  private modalStackId: number | null = null;

  protected readonly sortedAddOns = computed(() =>
    [...this.addOns()]
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

  protected readonly totalAddOnsCount = computed(() =>
    this.addOns().reduce((sum, group) => sum + group.options.length, 0),
  );

  protected readonly totalLinkedCount = computed(() =>
    this.linkedProducts().reduce((sum, group) => sum + group.options.length, 0),
  );

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.loadProduct(id);
    }
  }

  private loadProduct(id: string): void {
    this.isLoading.set(true);

    this.productService.getProduct(id).subscribe({
      next: (product) => {
        this.product.set(product);
        this.priceHistory.set(product.priceHistory || []);

        if (product.isAddOn) {
          // Load products that use this add-on
          this.productService.getLinkedProducts(id).subscribe({
            next: (linked) => {
              this.linkedProducts.set(linked);
              this.isLoading.set(false);
            },
            error: (err) => {
              console.error('Failed to load linked products:', err);
              this.isLoading.set(false);
            },
          });
        } else {
          // Load add-ons for this product
          this.productService.getProductAddOns(id).subscribe({
            next: (addOns) => {
              this.addOns.set(addOns);
              this.isLoading.set(false);
            },
            error: (err) => {
              console.error('Failed to load add-ons:', err);
              this.isLoading.set(false);
            },
          });
        }
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected goBack(): void {
    this.router.navigate(['/management/products']);
  }

  protected navigateToEdit(): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (this.product()) {
      this.router.navigate(['/management/products/edit', this.product()!.id]);
    }
  }

  protected deleteProduct(): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (!this.product()) {
      return;
    }

    this.showDeleteModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDelete());
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.removeFromStack();
  }

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (!this.product()) {
      return;
    }

    const productId = this.product()!.id;
    this.isDeleting.set(true);

    this.productService.deleteProduct(productId).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.removeFromStack();
        this.alertService.successDeleted('Product');
        this.router.navigateByUrl('/management/products');
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message || this.alertService.getDeleteErrorMessage('product'));
      },
    });
  }

  protected getProductCategoryName(category: ProductCategoryEnum): string {
    return ProductCategoryEnum[category];
  }

  protected openPriceHistory(): void {
    this.isHistoryOpen.set(true);
  }

  protected closePriceHistory(): void {
    this.isHistoryOpen.set(false);
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  protected toggleShowAllAddOns(): void {
    this.showAllAddOns.update((v) => !v);
  }

  protected toggleShowAllLinked(): void {
    this.showAllLinked.update((v) => !v);
  }

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }
}
