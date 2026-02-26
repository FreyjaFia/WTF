import { CommonModule } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import { CatalogCacheService, ModalStackService } from '@core/services';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { IconComponent } from '@shared/components/icons/icon/icon';
import {
  ADD_ON_TYPE_ORDER,
  AddOnGroupDto,
  AddOnTypeEnum,
  CartAddOnDto,
  ProductDto,
} from '@shared/models';

@Component({
  selector: 'app-addon-selector',
  imports: [CommonModule, IconComponent, AvatarComponent],
  templateUrl: './addon-selector.html',
})
export class AddonSelectorComponent {
  private readonly modalStack = inject(ModalStackService);
  private readonly catalogCache = inject(CatalogCacheService);

  private modalStackId: number | null = null;

  // Special instructions for this item
  protected readonly specialInstructions = signal<string>('');

  readonly addToCart = output<{
    product: ProductDto;
    addOns: CartAddOnDto[];
    quantity: number;
    specialInstructions?: string | null;
  }>();

  protected readonly isOpen = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly product = signal<ProductDto | null>(null);
  protected readonly productQuantity = signal(1);
  protected readonly addOnGroups = signal<AddOnGroupDto[]>([]);

  // Selections: key = group type, value = map of optionId → quantity
  protected readonly selections = signal<Record<number, Map<string, number>>>({});

  protected readonly AddOnTypeEnum = AddOnTypeEnum;

  protected readonly validationError = computed(() => {
    const groups = this.addOnGroups();
    const sel = this.selections();

    for (const group of groups) {
      const selected = sel[group.type];
      const activeOptions = group.options.filter((o) => o.isActive);

      if (
        (group.type === AddOnTypeEnum.Size || group.type === AddOnTypeEnum.Flavor) &&
        activeOptions.length > 0
      ) {
        const totalSelected = selected
          ? Array.from(selected.values()).reduce((s, q) => s + q, 0)
          : 0;

        if (totalSelected !== 1) {
          const label = group.type === AddOnTypeEnum.Size ? 'size' : 'flavor';
          return `Please select a ${label} to continue.`;
        }
      }

      // Sauce is optional but limited to 1
      if (group.type === AddOnTypeEnum.Sauce && activeOptions.length > 0) {
        const totalSelected = selected
          ? Array.from(selected.values()).reduce((s, q) => s + q, 0)
          : 0;

        if (totalSelected > 1) {
          return 'You can select at most one sauce.';
        }
      }
    }

    return null;
  });

  protected readonly selectedAddOns = computed<CartAddOnDto[]>(() => {
    const groups = this.addOnGroups();
    const sel = this.selections();
    const result: CartAddOnDto[] = [];

    for (const group of groups) {
      const selected = sel[group.type];

      if (!selected) {
        continue;
      }

      for (const option of group.options) {
        const qty = selected.get(option.id) ?? 0;

        for (let i = 0; i < qty; i++) {
          result.push({
            addOnId: option.id,
            name: option.name,
            price: option.overridePrice ?? option.price,
            addOnType: group.type,
          });
        }
      }
    }

    return result;
  });

  protected readonly addOnTotal = computed(() => {
    return this.selectedAddOns().reduce((sum, a) => sum + a.price, 0);
  });

  protected readonly unitPrice = computed(() => (this.product()?.price ?? 0) + this.addOnTotal());

  protected readonly totalPrice = computed(() => this.unitPrice() * this.productQuantity());

  public open(product: ProductDto): void {
    this.product.set(product);
    this.productQuantity.set(1);
    this.selections.set({});
    this.specialInstructions.set('');
    this.isOpen.set(true);
    this.modalStackId = this.modalStack.push(() => this.close());
    this.loadAddOns(product.id);
  }

  private loadAddOns(productId: string): void {
    this.isLoading.set(true);

    const groups = this.catalogCache.getAddOnsForProduct(productId);
    const deduped = groups
      .sort((a, b) => ADD_ON_TYPE_ORDER[a.type] - ADD_ON_TYPE_ORDER[b.type])
      .map((g) => ({
        ...g,
        options: g.options
          .filter((opt, i, arr) => arr.findIndex((o) => o.id === opt.id) === i)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));

    this.addOnGroups.set(deduped);
    this.isLoading.set(false);
  }

  protected getSelectionRule(type: AddOnTypeEnum): string {
    switch (type) {
      case AddOnTypeEnum.Size:
        return 'Required · Pick one';
      case AddOnTypeEnum.Flavor:
        return 'Required · Pick one';
      case AddOnTypeEnum.Sauce:
        return 'Optional · Pick one';
      case AddOnTypeEnum.Topping:
        return 'Optional · Pick many';
      case AddOnTypeEnum.Extra:
        return 'Optional · Pick many';
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

  protected isSelected(type: AddOnTypeEnum, optionId: string): boolean {
    const sel = this.selections();
    return (sel[type]?.get(optionId) ?? 0) > 0;
  }

  protected getQuantity(type: AddOnTypeEnum, optionId: string): number {
    const sel = this.selections();
    return sel[type]?.get(optionId) ?? 0;
  }

  protected toggleOption(group: AddOnGroupDto, option: ProductDto): void {
    if (!option.isActive) {
      return;
    }

    const sel = { ...this.selections() };
    const type = group.type;

    if (this.isRadioGroup(type)) {
      // Radio behavior: single selection
      const current = sel[type];
      const currentQty = current?.get(option.id) ?? 0;

      if (currentQty > 0) {
        // Sauce can be deselected (optional); Size and Flavor cannot
        if (type === AddOnTypeEnum.Sauce) {
          sel[type] = new Map<string, number>();
        }
      } else {
        sel[type] = new Map<string, number>([[option.id, 1]]);
      }
    } else {
      // Checkbox behavior: toggle (first click adds 1, second removes)
      const current = sel[type] ?? new Map<string, number>();
      const next = new Map(current);
      const qty = next.get(option.id) ?? 0;

      if (qty > 0) {
        next.delete(option.id);
      } else {
        next.set(option.id, 1);
      }

      sel[type] = next;
    }

    this.selections.set(sel);
  }

  protected incrementOption(group: AddOnGroupDto, option: ProductDto, event: Event): void {
    event.stopPropagation();

    if (!option.isActive) {
      return;
    }

    const sel = { ...this.selections() };
    const type = group.type;
    const current = sel[type] ?? new Map<string, number>();
    const next = new Map(current);

    next.set(option.id, (next.get(option.id) ?? 0) + 1);
    sel[type] = next;
    this.selections.set(sel);
  }

  protected decrementOption(group: AddOnGroupDto, option: ProductDto, event: Event): void {
    event.stopPropagation();

    const sel = { ...this.selections() };
    const type = group.type;
    const current = sel[type] ?? new Map<string, number>();
    const next = new Map(current);
    const qty = next.get(option.id) ?? 0;

    if (qty <= 1) {
      next.delete(option.id);
    } else {
      next.set(option.id, qty - 1);
    }

    sel[type] = next;
    this.selections.set(sel);
  }

  // Handler for textarea input
  protected onSpecialInstructionsInput(event: Event): void {
    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.specialInstructions.set(value);
  }

  protected incrementProductQuantity(event: Event): void {
    event.stopPropagation();
    this.productQuantity.update((qty) => Math.min(qty + 1, 99));
  }

  protected decrementProductQuantity(event: Event): void {
    event.stopPropagation();
    this.productQuantity.update((qty) => Math.max(qty - 1, 1));
  }

  protected confirm(): void {
    if (this.validationError()) {
      return;
    }

    const prod = this.product();

    if (!prod) {
      return;
    }

    this.addToCart.emit({
      product: prod,
      addOns: this.selectedAddOns(),
      quantity: this.productQuantity(),
      specialInstructions: this.specialInstructions().trim() || null,
    });

    this.close();
  }

  protected close(): void {
    this.isOpen.set(false);
    this.product.set(null);
    this.productQuantity.set(1);
    this.addOnGroups.set([]);
    this.selections.set({});
    this.specialInstructions.set('');

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
