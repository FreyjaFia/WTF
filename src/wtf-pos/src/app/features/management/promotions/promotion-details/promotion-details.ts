import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, AuthService, ModalStackService, ProductService, PromotionService } from '@core/services';
import { AvatarComponent, BadgeComponent, IconComponent } from '@shared/components';
import {
  ADD_ON_TYPE_ORDER,
  AddOnGroupDto,
  MixMatchItemAddOnDto,
  MixMatchItemDto,
  MixMatchPromotionDto,
  FixedBundleItemAddOnDto,
  FixedBundleItemDto,
  FixedBundlePromotionDto,
  ProductDto,
} from '@shared/models';
import { forkJoin, of, switchMap } from 'rxjs';

type PromotionDetailsType = 'fixed-bundle' | 'mix-match';

@Component({
  selector: 'app-promotion-details',
  imports: [CommonModule, IconComponent, BadgeComponent, AvatarComponent],
  templateUrl: './promotion-details.html',
  host: { class: 'block h-full' },
})
export class PromotionDetailsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly promotionService = inject(PromotionService);
  private readonly productService = inject(ProductService);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly modalStack = inject(ModalStackService);

  protected readonly isLoading = signal(false);
  protected readonly productsById = signal<Record<string, ProductDto>>({});
  protected readonly addOnGroupsByProductId = signal<Record<string, AddOnGroupDto[]>>({});
  protected readonly fixedBundle = signal<FixedBundlePromotionDto | null>(null);
  protected readonly mixMatch = signal<MixMatchPromotionDto | null>(null);
  protected readonly type = signal<PromotionDetailsType>('fixed-bundle');
  protected readonly showAllBundleItems = signal(false);
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
  private modalStackId: number | null = null;

  protected readonly promotionName = computed(() =>
    this.type() === 'fixed-bundle' ? this.fixedBundle()?.name ?? '' : this.mixMatch()?.name ?? '',
  );
  protected readonly lastUpdatedAt = computed(() =>
    this.type() === 'fixed-bundle'
      ? this.fixedBundle()?.updatedAt ?? this.fixedBundle()?.createdAt ?? null
      : this.mixMatch()?.updatedAt ?? this.mixMatch()?.createdAt ?? null,
  );

  protected readonly isActive = computed(() =>
    this.type() === 'fixed-bundle' ? this.fixedBundle()?.isActive ?? false : this.mixMatch()?.isActive ?? false,
  );

  protected readonly heroImageUrl = computed(() =>
    this.type() === 'fixed-bundle'
      ? this.fixedBundle()?.imageUrl ?? null
      : this.mixMatch()?.imageUrl ?? null,
  );
  protected readonly heroLabel = computed(() => this.promotionName());

  protected readonly headlinePrice = computed(() => {
    if (this.type() === 'fixed-bundle') {
      return this.fixedBundle()?.bundlePrice ?? 0;
    }

    return this.mixMatch()?.bundlePrice ?? 0;
  });

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/management/promotions']);
      return;
    }

    this.type.set(this.resolveTypeFromRoute());
    this.loadPromotion(id);
  }

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }

  protected goBack(): void {
    this.router.navigate(['/management/promotions']);
  }

  protected navigateToEdit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      return;
    }

    this.router.navigate(this.buildEditRoute(id, this.type()));
  }

  protected getProductName(productId: string): string {
    return this.productsById()[productId]?.name ?? 'Unknown product';
  }

  protected getGroupedItemAddOns(item: FixedBundleItemDto): { typeLabel: string; options: FixedBundleItemAddOnDto[] }[] {
    return this.groupAddOns(item.productId, item.addOns);
  }

  protected getGroupedMixMatchItemAddOns(item: MixMatchItemDto): { typeLabel: string; options: MixMatchItemAddOnDto[] }[] {
    return this.groupAddOns(item.productId, item.addOns);
  }

  protected deletePromotion(): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
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

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      return;
    }

    const request$ =
      this.type() === 'mix-match'
        ? this.promotionService.deleteMixMatch(id)
        : this.promotionService.deleteFixedBundle(id);

    this.isDeleting.set(true);
    request$.subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.removeFromStack();
        this.alertService.successDeleted('Promotion');
        this.router.navigate(['/management/promotions']);
      },
      error: (err: Error) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  private loadPromotion(id: string): void {
    this.isLoading.set(true);

    this.productService
      .getProducts()
      .pipe(
        switchMap((products) => {
          this.productsById.set(Object.fromEntries(products.map((x) => [x.id, x])));

          if (this.type() === 'mix-match') {
            return forkJoin({
              fixed: of<FixedBundlePromotionDto | null>(null),
              mixMatch: this.promotionService.getMixMatchPromotion(id),
            });
          }

          return forkJoin({
            fixed: this.promotionService.getFixedBundle(id),
            mixMatch: of<MixMatchPromotionDto | null>(null),
          });
        }),
      )
      .subscribe({
        next: ({ fixed, mixMatch }) => {
          this.fixedBundle.set(fixed);
          this.mixMatch.set(mixMatch);
          this.primeAddOnGroupCache();
          this.isLoading.set(false);
        },
        error: (err: Error) => {
          this.alertService.error(err.message);
          this.isLoading.set(false);
          this.router.navigate(['/management/promotions']);
        },
      });
  }

  private getHeroProduct(): ProductDto | null {
    if (this.type() === 'fixed-bundle') {
      const firstItem = this.fixedBundle()?.items[0];
      return firstItem ? this.productsById()[firstItem.productId] ?? null : null;
    }

    const firstItem = this.mixMatch()?.items[0];
    return firstItem ? this.productsById()[firstItem.productId] ?? null : null;
  }

  private groupAddOns<T extends { addOnProductId: string }>(
    parentProductId: string,
    addOns: T[],
  ): { typeLabel: string; options: T[] }[] {
    if (!parentProductId || addOns.length === 0) {
      return [];
    }

    const groups = this.addOnGroupsByProductId()[parentProductId] ?? [];
    const metaByAddOnId = new Map<string, { order: number; label: string }>();
    for (const group of groups) {
      for (const option of group.options) {
        metaByAddOnId.set(option.id, { order: ADD_ON_TYPE_ORDER[group.type], label: group.displayName });
      }
    }

    const byType = new Map<string, { order: number; options: T[] }>();
    for (const addOn of addOns) {
      const meta = metaByAddOnId.get(addOn.addOnProductId) ?? { order: 999, label: 'Other' };
      const existing = byType.get(meta.label) ?? { order: meta.order, options: [] };
      existing.options.push(addOn);
      byType.set(meta.label, existing);
    }

    return [...byType.entries()]
      .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
      .map(([typeLabel, value]) => ({
        typeLabel,
        options: [...value.options].sort((a, b) =>
          this.getProductName(a.addOnProductId).localeCompare(this.getProductName(b.addOnProductId)),
        ),
      }));
  }

  private primeAddOnGroupCache(): void {
    const ids = new Set<string>();
    const fixed = this.fixedBundle();
    const mixMatch = this.mixMatch();

    if (fixed) {
      for (const item of fixed.items) {
        if (item.productId) {
          ids.add(item.productId);
        }
      }
    }

    if (mixMatch) {
      for (const item of mixMatch.items) {
        if (item.productId) {
          ids.add(item.productId);
        }
      }
    }

    for (const productId of ids) {
      if (this.addOnGroupsByProductId()[productId]) {
        continue;
      }

      this.productService.getProductAddOns(productId).subscribe({
        next: (groups) =>
          this.addOnGroupsByProductId.update((state) => ({
            ...state,
            [productId]: groups,
          })),
        error: () =>
          this.addOnGroupsByProductId.update((state) => ({
            ...state,
            [productId]: [],
          })),
      });
    }
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  private resolveTypeFromRoute(): PromotionDetailsType {
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

  private buildEditRoute(id: string, type: PromotionDetailsType): string[] {
    return type === 'mix-match'
      ? ['/management/promotions/mix-match', id, 'edit']
      : ['/management/promotions/fixed-bundles', id, 'edit'];
  }
}

