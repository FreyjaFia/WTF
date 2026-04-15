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
  protected readonly editingIndex = signal<number | null>(null);

  readonly addToCart = output<{
    product: ProductDto;
    addOns: CartAddOnDto[];
    quantity: number;
    specialInstructions?: string | null;
    editIndex?: number | null;
  }>();

  protected readonly isOpen = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly product = signal<ProductDto | null>(null);
  protected readonly productQuantity = signal(1);
  protected readonly addOnGroups = signal<AddOnGroupDto[]>([]);
  protected readonly isCustomOptionMode = signal(false);
  protected readonly customRequiredSelectionCount = signal<number | null>(null);
  protected readonly scaleRequiredSelectionByQuantity = signal(false);
  protected readonly customMaxSelectionPerOption = signal<number | null>(null);
  protected readonly subtitleText = signal('Customize your order');
  protected readonly promoLabel = signal<string | null>(null);
  protected readonly promoRules = signal<
    { fixedPrice?: number | null; percentOff?: number | null; addOns: { addOnProductId: string; quantity: number }[] }[]
  >([]);

  // Selections: key = group type, value = map of optionId â†’ quantity
  protected readonly selections = signal<Record<number, Map<string, number>>>({});

  protected readonly AddOnTypeEnum = AddOnTypeEnum;

  protected readonly validationError = computed(() => {
    if (this.isCustomOptionMode()) {
      const required = this.getScaledRequiredSelectionCount();
      const maxPerOption = this.customMaxSelectionPerOption();
      const sel = this.selections();

      if (required !== null) {
        const totalSelected = Object.values(sel).reduce(
          (sum, optionMap) => sum + Array.from(optionMap.values()).reduce((inner, qty) => inner + qty, 0),
          0,
        );
        if (totalSelected !== required) {
          return `Select exactly ${required} item(s).`;
        }
      }

      if (maxPerOption !== null) {
        for (const optionMap of Object.values(sel)) {
          for (const qty of optionMap.values()) {
            if (qty > maxPerOption) {
              return `You can select up to ${maxPerOption} of the same item.`;
            }
          }
        }
      }

      return null;
    }

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

  protected readonly unitPrice = computed(() => {
    const basePrice = this.product()?.price ?? 0;
    const discountedBase = this.getDiscountedBasePrice(basePrice);
    return (discountedBase ?? basePrice) + this.addOnTotal();
  });

  protected readonly totalPrice = computed(() => this.unitPrice() * this.productQuantity());
  protected readonly activePromoLabel = computed(() => {
    const rules = this.promoRules();
    if (rules.length === 0) {
      return null;
    }

    const basePrice = this.product()?.price ?? 0;
    const addOnCounts = new Map<string, number>();
    for (const addOn of this.selectedAddOns()) {
      addOnCounts.set(addOn.addOnId, (addOnCounts.get(addOn.addOnId) ?? 0) + 1);
    }

    let best: { fixedPrice?: number | null; percentOff?: number | null; price: number } | null = null;
    for (const rule of rules) {
      if (!this.satisfiesRequiredAddOns(addOnCounts, rule.addOns)) {
        continue;
      }

      const discounted = this.calculateDiscountedPrice(
        basePrice,
        rule.fixedPrice ?? null,
        rule.percentOff ?? null,
      );
      if (discounted == null) {
        continue;
      }

      if (!best || discounted < best.price) {
        best = { fixedPrice: rule.fixedPrice, percentOff: rule.percentOff, price: discounted };
      }
    }

    if (!best) {
      return null;
    }

    if (best.fixedPrice != null && best.fixedPrice > 0) {
      return `Promo -\u20B1${this.formatCurrency(best.fixedPrice)}`;
    }

    if (best.percentOff != null && best.percentOff > 0) {
      const percent = best.percentOff.toLocaleString('en-PH', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      return `Promo -${percent}%`;
    }

    return null;
  });

  public open(
    product: ProductDto,
    options?: {
      quantity?: number;
      addOns?: CartAddOnDto[];
      specialInstructions?: string | null;
      editIndex?: number | null;
      customGroups?: AddOnGroupDto[];
      requiredSelectionCount?: number | null;
      scaleRequiredSelectionByQuantity?: boolean;
      maxSelectionPerOption?: number | null;
      subtitleText?: string;
      promoLabel?: string | null;
      promoRules?: {
        fixedPrice?: number | null;
        percentOff?: number | null;
        addOns: { addOnProductId: string; quantity: number }[];
      }[];
    },
  ): void {
    this.product.set(product);
    this.productQuantity.set(Math.max(1, Math.min(options?.quantity ?? 1, 99)));
    this.selections.set({});
    this.specialInstructions.set(options?.specialInstructions ?? '');
    this.editingIndex.set(options?.editIndex ?? null);
    this.isCustomOptionMode.set(!!options?.customGroups);
    this.customRequiredSelectionCount.set(options?.requiredSelectionCount ?? null);
    this.scaleRequiredSelectionByQuantity.set(!!options?.scaleRequiredSelectionByQuantity);
    this.customMaxSelectionPerOption.set(options?.maxSelectionPerOption ?? null);
    this.subtitleText.set(options?.subtitleText ?? 'Customize your order');
    this.promoLabel.set(options?.promoLabel ?? null);
    this.promoRules.set(options?.promoRules ?? []);
    this.isOpen.set(true);
    this.modalStackId = this.modalStack.push(() => this.close());
    this.loadAddOns(product.id, options?.addOns, options?.customGroups);
  }

  private loadAddOns(
    productId: string,
    initialAddOns?: CartAddOnDto[],
    customGroups?: AddOnGroupDto[],
  ): void {
    this.isLoading.set(true);

    const groups = customGroups ?? this.catalogCache.getAddOnsForProduct(productId);
    const deduped = groups
      .sort((a, b) => ADD_ON_TYPE_ORDER[a.type] - ADD_ON_TYPE_ORDER[b.type])
      .map((g) => ({
        ...g,
        options: g.options
          .filter((opt, i, arr) => arr.findIndex((o) => o.id === opt.id) === i)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));

    this.addOnGroups.set(deduped);
    this.applyInitialSelections(deduped, initialAddOns ?? []);
    this.isLoading.set(false);
  }

  private applyInitialSelections(groups: AddOnGroupDto[], addOns: CartAddOnDto[]): void {
    if (addOns.length === 0) {
      this.selections.set({});
      return;
    }

    const optionTypeById = new Map(
      groups.flatMap((group) => group.options.map((option) => [option.id, group.type] as const)),
    );
    const nextSelections: Record<number, Map<string, number>> = {};

    for (const addOn of addOns) {
      const type = addOn.addOnType ?? optionTypeById.get(addOn.addOnId);

      if (!type) {
        continue;
      }

      const current = nextSelections[type] ?? new Map<string, number>();
      current.set(addOn.addOnId, (current.get(addOn.addOnId) ?? 0) + 1);
      nextSelections[type] = current;
    }

    this.selections.set(nextSelections);
  }

  protected getSelectionRule(type: AddOnTypeEnum): string {
    if (this.isCustomOptionMode()) {
      const required = this.getScaledRequiredSelectionCount();
      const maxPerOption = this.customMaxSelectionPerOption();

      if (required !== null && maxPerOption !== null) {
        return `Pick many · Max selected ${required} · Max ${maxPerOption}/item`;
      }

      if (required !== null) {
        return `Pick many · Max selected ${required}`;
      }

      return maxPerOption ? `Pick many · Max ${maxPerOption}/item` : 'Pick many';
    }

    switch (type) {
      case AddOnTypeEnum.Size:
        return 'Required · Pick one';
      case AddOnTypeEnum.Flavor:
        return 'Required · Pick one';
      case AddOnTypeEnum.Sauce:
        return 'Required · Pick one';
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
      // Quantity behavior for multi-select: each row click changes by exactly 1.
      const current = sel[type] ?? new Map<string, number>();
      const next = new Map(current);
      const qty = next.get(option.id) ?? 0;

      if (qty > 1) {
        next.set(option.id, qty - 1);
      } else if (qty === 1) {
        next.delete(option.id);
      } else {
        if (!this.canIncrementOption(group, option.id)) {
          return;
        }

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

    if (!this.canIncrementOption(group, option.id)) {
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
  protected canIncrementOption(group: AddOnGroupDto, optionId: string): boolean {
    if (!this.isCustomOptionMode()) {
      return true;
    }

    const sel = this.selections();
    const currentOptionQty = sel[group.type]?.get(optionId) ?? 0;
    const maxPerOption = this.customMaxSelectionPerOption();
    if (maxPerOption !== null && currentOptionQty >= maxPerOption) {
      return false;
    }

    const required = this.getScaledRequiredSelectionCount();
    if (required !== null) {
      const totalSelected = Object.values(sel).reduce(
        (sum, optionMap) =>
          sum + Array.from(optionMap.values()).reduce((inner, qty) => inner + qty, 0),
        0,
      );

      if (totalSelected >= required) {
        return false;
      }
    }

    return true;
  }
  // Handler for textarea input
  protected onSpecialInstructionsInput(event: Event): void {
    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.specialInstructions.set(value);
  }

  protected incrementProductQuantity(event: Event): void {
    event.stopPropagation();
    const previous = this.productQuantity();
    const next = Math.min(previous + 1, 99);
    this.productQuantity.set(next);
    this.scaleSelectionsForQuantityChange(previous, next);
    this.rebalanceSelectionsForRequiredLimit();
  }

  protected decrementProductQuantity(event: Event): void {
    event.stopPropagation();
    const previous = this.productQuantity();
    const next = Math.max(previous - 1, 1);
    this.productQuantity.set(next);
    this.scaleSelectionsForQuantityChange(previous, next);
    this.rebalanceSelectionsForRequiredLimit();
  }

  private getScaledRequiredSelectionCount(): number | null {
    const required = this.customRequiredSelectionCount();
    if (required === null) {
      return null;
    }

    if (!this.scaleRequiredSelectionByQuantity()) {
      return required;
    }

    return required * this.productQuantity();
  }

  private rebalanceSelectionsForRequiredLimit(): void {
    if (!this.isCustomOptionMode()) {
      return;
    }

    const required = this.getScaledRequiredSelectionCount();
    if (required === null) {
      return;
    }

    const currentSelections = this.selections();
    const nextSelections: Record<number, Map<string, number>> = {};
    for (const [type, optionMap] of Object.entries(currentSelections)) {
      nextSelections[+type] = new Map(optionMap);
    }

    const getTotalSelected = (): number =>
      Object.values(nextSelections).reduce(
        (sum, optionMap) =>
          sum + Array.from(optionMap.values()).reduce((inner, qty) => inner + qty, 0),
        0,
      );

    let totalSelected = getTotalSelected();
    if (totalSelected <= required) {
      return;
    }

    while (totalSelected > required) {
      let changed = false;

      for (const optionMap of Object.values(nextSelections)) {
        for (const [optionId, qty] of optionMap.entries()) {
          if (totalSelected <= required) {
            break;
          }

          if (qty <= 1) {
            optionMap.delete(optionId);
          } else {
            optionMap.set(optionId, qty - 1);
          }

          totalSelected -= 1;
          changed = true;
        }

        if (totalSelected <= required) {
          break;
        }
      }

      if (!changed) {
        break;
      }
    }

    this.selections.set(nextSelections);
  }

  private scaleSelectionsForQuantityChange(previousQty: number, nextQty: number): void {
    if (previousQty <= 0 || previousQty === nextQty) {
      return;
    }

    // Only custom group flows (ex: mix-and-match) should scale selections with base qty.
    // Standard add-on groups (Size/Flavor/Sauce/Topping/Extra) are per-unit selections.
    if (!this.isCustomOptionMode() || !this.scaleRequiredSelectionByQuantity()) {
      return;
    }

    const current = this.selections();
    const nextSelections: Record<number, Map<string, number>> = {};

    for (const [typeKey, optionMap] of Object.entries(current)) {
      const nextMap = new Map<string, number>();
      for (const [optionId, qty] of optionMap.entries()) {
        const perUnit = qty / previousQty;
        const scaled = Math.max(0, Math.round(perUnit * nextQty));
        if (scaled > 0) {
          nextMap.set(optionId, scaled);
        }
      }

      nextSelections[+typeKey] = nextMap;
    }

    this.selections.set(nextSelections);
  }

  private getDiscountedBasePrice(basePrice: number): number | null {
    const rules = this.promoRules();
    if (rules.length === 0) {
      return null;
    }

    const addOnCounts = new Map<string, number>();
    for (const addOn of this.selectedAddOns()) {
      addOnCounts.set(addOn.addOnId, (addOnCounts.get(addOn.addOnId) ?? 0) + 1);
    }

    let best: number | null = null;
    for (const rule of rules) {
      if (!this.satisfiesRequiredAddOns(addOnCounts, rule.addOns)) {
        continue;
      }

      const discounted = this.calculateDiscountedPrice(
        basePrice,
        rule.fixedPrice ?? null,
        rule.percentOff ?? null,
      );
      if (discounted == null) {
        continue;
      }

      if (best == null || discounted < best) {
        best = discounted;
      }
    }

    return best;
  }

  private satisfiesRequiredAddOns(
    addOnCounts: Map<string, number>,
    requiredAddOns: { addOnProductId: string; quantity: number }[],
  ): boolean {
    if (requiredAddOns.length === 0) {
      return false;
    }

    const requiredSet = new Set(requiredAddOns.map((r) => r.addOnProductId));
    for (const required of requiredAddOns) {
      const qty = addOnCounts.get(required.addOnProductId) ?? 0;
      const expected = required.quantity;
      if (qty !== expected) {
        return false;
      }
    }

    for (const [id, qty] of addOnCounts.entries()) {
      if (!requiredSet.has(id) && qty > 0) {
        return false;
      }
    }

    return true;
  }

  private calculateDiscountedPrice(
    basePrice: number,
    fixedPrice?: number | null,
    percentOff?: number | null,
  ): number | null {
    if (fixedPrice != null && fixedPrice > 0) {
      return Math.max(0, basePrice - fixedPrice);
    }

    if (percentOff != null && percentOff > 0) {
      const discounted = basePrice * (1 - percentOff / 100);
      return Math.round(discounted * 100) / 100;
    }

    return null;
  }

  private formatCurrency(value: number): string {
    return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      editIndex: this.editingIndex(),
    });

    this.close();
  }

  protected close(): void {
    this.isOpen.set(false);
    this.product.set(null);
    this.productQuantity.set(1);
    this.addOnGroups.set([]);
    this.selections.set({});
    this.isCustomOptionMode.set(false);
    this.customRequiredSelectionCount.set(null);
    this.scaleRequiredSelectionByQuantity.set(false);
    this.customMaxSelectionPerOption.set(null);
    this.subtitleText.set('Customize your order');
    this.promoLabel.set(null);
    this.promoRules.set([]);
    this.specialInstructions.set('');
    this.editingIndex.set(null);

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
