import type { AddOnGroupDto, CartAddOnDto, CartBundleItemDto, ProductDto } from '@shared/models';
import { PromotionTypeEnum, SYSTEM_CATALOG_IDS } from '@shared/models';

export interface BundleItemSource {
  productId: string;
  addOns: { addOnProductId: string; quantity: number }[];
  quantity?: number;
}

export interface BundlePromotionSelection {
  id: string;
  name: string;
  typeId: PromotionTypeEnum;
  isActive: boolean;
  imageUrl?: string | null;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  bundlePrice: number;
  requiredQuantity?: number;
  maxSelectionsPerOrder?: number | null;
  items: BundleItemSource[];
}

export function mixMatchOptionGroups(
  bundle: BundlePromotionSelection,
  allProducts: ProductDto[],
): AddOnGroupDto[] {
  const productById = new Map(allProducts.map((x) => [x.id, x]));

  const options = bundle.items
    .map((item) => productById.get(item.productId))
    .filter((x): x is ProductDto => !!x)
    .map((product) => ({
      ...product,
      price: 0,
      overridePrice: 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [
    {
      type: SYSTEM_CATALOG_IDS.extraAddOnType,
      displayName: 'Items',
      options,
    },
  ];
}

export function preselectedMixMatchOptions(
  bundle: BundlePromotionSelection,
  allProducts: ProductDto[],
): CartAddOnDto[] {
  const selections: CartAddOnDto[] = [];
  const optionById = new Map(
    mixMatchOptionGroups(bundle, allProducts)[0]?.options.map((x) => [x.id, x]) ?? [],
  );

  for (const item of bundle.items) {
    const qty = Math.max(0, item.quantity ?? 0);
    if (qty <= 0) {
      continue;
    }

    const option = optionById.get(item.productId);
    for (let i = 0; i < qty; i++) {
      selections.push({
        addOnId: item.productId,
        name: option?.name ?? 'Selected item',
        price: 0,
        addOnType: SYSTEM_CATALOG_IDS.extraAddOnType,
      });
    }
  }

  return selections;
}

export function mixMatchSelectionFromAddonSelection(
  bundle: BundlePromotionSelection,
  selectedOptions: CartAddOnDto[],
): BundlePromotionSelection {
  const selectedCountByProductId = new Map<string, number>();
  for (const option of selectedOptions) {
    selectedCountByProductId.set(
      option.addOnId,
      (selectedCountByProductId.get(option.addOnId) ?? 0) + 1,
    );
  }

  return {
    ...bundle,
    items: bundle.items
      .map((item) => ({
        ...item,
        quantity: selectedCountByProductId.get(item.productId) ?? 0,
      }))
      .filter((item) => (item.quantity ?? 0) > 0),
  };
}

export function bundleCartItems(
  bundle: BundlePromotionSelection,
  allProducts: ProductDto[],
  addOnsForProduct: (productId: string) => AddOnGroupDto[],
): CartBundleItemDto[] {
  const productById = new Map(allProducts.map((p) => [p.id, p]));
  const bundleItems: CartBundleItemDto[] = [];

  for (const bundleItem of bundle.items) {
    const product = productById.get(bundleItem.productId);
    if (!product) {
      continue;
    }

    const addOnGroups = addOnsForProduct(product.id);
    const addOnTypeById = new Map(
      addOnGroups.flatMap((group) =>
        group.options.map((option) => [option.id, group.type] as const),
      ),
    );
    const addOnOptionById = new Map(
      addOnGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)),
    );

    const expandedAddOns: CartAddOnDto[] = [];
    for (const addOn of bundleItem.addOns ?? []) {
      const addOnOption = addOnOptionById.get(addOn.addOnProductId);
      const addOnProduct = productById.get(addOn.addOnProductId);
      const qty = Math.max(1, addOn.quantity || 1);

      for (let i = 0; i < qty; i++) {
        expandedAddOns.push({
          addOnId: addOn.addOnProductId,
          name: addOnOption?.name ?? addOnProduct?.name ?? 'Add-on',
          price: addOnOption?.overridePrice ?? addOnOption?.price ?? addOnProduct?.price ?? 0,
          addOnType: addOnTypeById.get(addOn.addOnProductId),
        });
      }
    }

    bundleItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      qty: Math.max(1, bundleItem.quantity || 1),
      imageUrl: product.imageUrl,
      addOns: expandedAddOns.length > 0 ? expandedAddOns : undefined,
    });
  }

  return [...bundleItems].sort((a, b) => a.name.localeCompare(b.name));
}
