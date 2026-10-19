import { DecimalPipe } from '@angular/common';
import { Component, computed, input, OnInit, output, signal } from '@angular/core';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { IconComponent } from '@shared/components/icons/icon/icon';
import {
  ADD_ON_TYPE_ORDER,
  AddOnTypeEnum,
  PublicAddOnGroupDto,
  PublicCartAddOn,
  PublicProductDto,
} from '@shared/models';
import {
  addOnsTotal,
  DiscountRule,
  extendedPrice,
  findBestDiscount,
  formatPromoLabel,
  fromCents,
  priceWithAddOns,
  toCents,
} from '@shared/calculations';

export interface PublicAddonPickerResult {
  addOns: PublicCartAddOn[];
  quantity: number;
  specialInstructions: string | null;
}

export const MAX_SPECIAL_INSTRUCTIONS = 100;
export const MAX_ITEM_QUANTITY = 99;
export const MAX_ADD_ON_QUANTITY = 99;

/**
 * Add-on choices for one product on the public ordering page. It works only from the groups it is given (loaded
 * fresh by the page) and never reads a cached catalog. The server checks the real rules again on submit.
 */
@Component({
  selector: 'app-public-addon-picker',
  imports: [DecimalPipe, IconComponent, AvatarComponent],
  templateUrl: './public-addon-picker.html',
})
export class PublicAddonPickerComponent implements OnInit {
  public readonly product = input.required<PublicProductDto>();
  public readonly groups = input.required<PublicAddOnGroupDto[]>();

  /** Starting choices when an item already in the cart is being edited. */
  public readonly initial = input<PublicAddonPickerResult | null>(null);

  /** Add-ons to start with for a new item (a deal card), without making it an edit. */
  public readonly startWith = input<readonly PublicCartAddOn[] | null>(null);

  /** The discounts that are on for this product. The one whose add-ons match the choices lowers the price. */
  public readonly rules = input<readonly (DiscountRule & { remaining?: number | null })[]>([]);

  public readonly confirmed = output<PublicAddonPickerResult>();
  public readonly cancelled = output<void>();

  protected readonly maxInstructions = MAX_SPECIAL_INSTRUCTIONS;
  protected readonly AddOnTypeEnum = AddOnTypeEnum;

  protected readonly quantity = signal(1);
  protected readonly instructions = signal('');
  /** How many of each add-on are selected, per group type: type -> add-on id -> quantity. */
  protected readonly selected = signal<Record<number, Record<string, number>>>({});

  protected readonly isEditing = computed(() => this.initial() !== null);

  public ngOnInit(): void {
    const initial =
      this.initial() ??
      (this.startWith()
        ? { addOns: [...this.startWith()!], quantity: 1, specialInstructions: null }
        : null);
    if (!initial) {
      return;
    }

    this.quantity.set(Math.min(MAX_ITEM_QUANTITY, Math.max(1, initial.quantity)));
    this.instructions.set((initial.specialInstructions ?? '').slice(0, MAX_SPECIAL_INSTRUCTIONS));

    // Put each add-on back under its group. Add-ons that are no longer offered for this product are dropped.
    const next: Record<number, Record<string, number>> = {};
    for (const group of this.groups()) {
      for (const option of group.options) {
        const wanted = initial.addOns.find((a) => a.id === option.id);
        if (wanted && wanted.quantity > 0) {
          next[group.type] = {
            ...next[group.type],
            [option.id]: Math.min(MAX_ADD_ON_QUANTITY, wanted.quantity),
          };
        }
      }
    }
    this.selected.set(next);
  }

  protected readonly sortedGroups = computed(() =>
    [...this.groups()]
      .map((group) => ({
        ...group,
        options: [...group.options].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => this.order(a.type) - this.order(b.type)),
  );

  protected readonly selectedAddOns = computed<PublicCartAddOn[]>(() => {
    const selected = this.selected();

    return this.sortedGroups().flatMap((group) =>
      group.options
        .filter((option) => (selected[group.type]?.[option.id] ?? 0) > 0)
        .map((option) => ({
          id: option.id,
          name: option.name,
          price: option.price,
          quantity: selected[group.type][option.id],
        })),
    );
  });

  /** What the chosen add-ons add to the price of one item. */
  protected readonly addOnTotal = computed(() => addOnsTotal(this.selectedAddOns()));

  /** The best discount whose add-ons match the choices exactly, or null. */
  private readonly bestDiscount = computed(() =>
    findBestDiscount(
      this.product().price,
      this.selectedAddOns().flatMap((addOn) =>
        Array.from({ length: addOn.quantity }, () => addOn.id),
      ),
      this.rules(),
      this.quantity(),
    ),
  );

  protected readonly discount = computed(() => {
    const best = this.bestDiscount();
    return best
      ? { price: best.price, label: formatPromoLabel(best.rule, this.product().price, this.addOnTotal()) }
      : null;
  });

  protected readonly unitPrice = computed(() =>
    priceWithAddOns(this.discount()?.price ?? this.product().price, this.selectedAddOns()),
  );

  protected readonly total = computed(() => {
    const discount = this.bestDiscount();
    if (!discount) {
      return extendedPrice(this.unitPrice(), this.quantity());
    }

    // A limit can cover only some of the items; the rest pay the list price.
    const cents =
      toCents(priceWithAddOns(discount.price, this.selectedAddOns())) * discount.quantity +
      toCents(priceWithAddOns(this.product().price, this.selectedAddOns())) *
        (this.quantity() - discount.quantity);
    return fromCents(cents);
  });

  /** Size and flavor need exactly one choice, sauce at most one (same as the shop's own ordering screen). */
  protected readonly validationError = computed<string | null>(() => {
    const selected = this.selected();

    for (const group of this.sortedGroups()) {
      const count = this.countOf(group.type);

      if (group.type === AddOnTypeEnum.Size && group.options.length > 0 && count !== 1) {
        return 'Please select a size to continue.';
      }

      if (group.type === AddOnTypeEnum.Flavor && group.options.length > 0 && count !== 1) {
        return 'Please select a flavor to continue.';
      }

      if (group.type === AddOnTypeEnum.Sauce && count > 1) {
        return 'You can select at most one sauce.';
      }
    }

    return null;
  });

  protected selectionRule(type: number): string {
    if (type === AddOnTypeEnum.Size || type === AddOnTypeEnum.Flavor) {
      return 'Required · Pick one';
    }

    return type === AddOnTypeEnum.Sauce ? 'Optional · Pick one' : 'Optional · Pick many';
  }

  protected isSingleChoice(type: number): boolean {
    return (
      type === AddOnTypeEnum.Size || type === AddOnTypeEnum.Flavor || type === AddOnTypeEnum.Sauce
    );
  }

  protected isSelected(type: number, id: string): boolean {
    return this.quantityOf(type, id) > 0;
  }

  protected quantityOf(type: number, id: string): number {
    return this.selected()[type]?.[id] ?? 0;
  }

  /** Total number of add-ons chosen in one group. */
  private countOf(type: number): number {
    return Object.values(this.selected()[type] ?? {}).reduce((sum, qty) => sum + qty, 0);
  }

  /**
   * Same as the shop's own screen. Size, flavor and sauce are pick-one: choosing another replaces it, and only a
   * sauce can be cleared. For toppings and extras each click changes the quantity by one, down to none.
   */
  protected toggle(type: number, id: string): void {
    const current = this.selected()[type] ?? {};
    const qty = current[id] ?? 0;
    let next: Record<string, number>;

    if (this.isSingleChoice(type)) {
      if (qty > 0) {
        next = type === AddOnTypeEnum.Sauce ? {} : current;
      } else {
        next = { [id]: 1 };
      }
    } else if (qty > 1) {
      next = { ...current, [id]: qty - 1 };
    } else if (qty === 1) {
      next = Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
    } else {
      next = { ...current, [id]: 1 };
    }

    this.selected.update((s) => ({ ...s, [type]: next }));
  }

  protected canIncrement(type: number, id: string): boolean {
    return this.quantityOf(type, id) < MAX_ADD_ON_QUANTITY;
  }

  protected incrementAddOn(type: number, id: string, event: Event): void {
    event.stopPropagation();

    if (!this.canIncrement(type, id)) {
      return;
    }

    this.selected.update((s) => ({
      ...s,
      [type]: { ...s[type], [id]: this.quantityOf(type, id) + 1 },
    }));
  }

  protected decrementAddOn(type: number, id: string, event: Event): void {
    event.stopPropagation();

    const qty = this.quantityOf(type, id);
    const current = this.selected()[type] ?? {};
    const next =
      qty <= 1
        ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
        : { ...current, [id]: qty - 1 };

    this.selected.update((s) => ({ ...s, [type]: next }));
  }

  protected changeQuantity(delta: number): void {
    this.quantity.update((q) => Math.min(MAX_ITEM_QUANTITY, Math.max(1, q + delta)));
  }

  protected onInstructions(value: string): void {
    this.instructions.set(value.slice(0, MAX_SPECIAL_INSTRUCTIONS));
  }

  protected confirm(): void {
    if (this.validationError()) {
      return;
    }

    this.confirmed.emit({
      addOns: this.selectedAddOns(),
      quantity: this.quantity(),
      specialInstructions: this.instructions().trim() || null,
    });
  }

  private order(type: number): number {
    return ADD_ON_TYPE_ORDER[type as AddOnTypeEnum] ?? 99;
  }
}
