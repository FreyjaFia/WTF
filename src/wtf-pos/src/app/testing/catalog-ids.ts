// The ids the seeded catalog uses, for specs that need a category, sub-category or add-on type.
type NamedIds<K extends string> = { [P in K]: number } & { [id: number]: string };

function namedIds<K extends string>(ids: Record<K, number>): NamedIds<K> {
  const result: Record<string | number, string | number> = { ...ids };
  for (const [name, id] of Object.entries<number>(ids)) {
    result[id] = name;
  }

  return result as unknown as NamedIds<K>;
}

export type ProductCategoryEnum = number;
export const ProductCategoryEnum = namedIds({ Drink: 1, Food: 2, Dessert: 3, Other: 4 });

export type ProductSubCategoryEnum = number;
export const ProductSubCategoryEnum = namedIds({ Coffee: 1, NonCoffee: 2, Snacks: 3, Retail: 4 });

export type AddOnTypeEnum = number;
export const AddOnTypeEnum = namedIds({ Size: 1, Flavor: 2, Topping: 3, Extra: 4, Sauce: 5 });

export const PRODUCT_SUB_CATEGORY_LABELS: Record<number, string> = {
  1: 'Coffee',
  2: 'Non-Coffee',
  3: 'Snacks',
  4: 'Retail',
};

export const REQUIRED_ONE = { isRequired: true, minSelect: 1, maxSelect: 1 } as const;
export const OPTIONAL_ONE = { isRequired: false, minSelect: 0, maxSelect: 1 } as const;

export const SEEDED_LOOKUPS = {
  categories: [
    { id: 1, name: 'Drink', sortOrder: 1, isActive: true },
    { id: 2, name: 'Food', sortOrder: 2, isActive: true },
    { id: 3, name: 'Dessert', sortOrder: 3, isActive: true },
    { id: 4, name: 'Other', sortOrder: 4, isActive: true },
  ],
  subCategories: [
    { id: 1, name: 'Coffee', categoryId: 1, sortOrder: 1, isActive: true },
    { id: 2, name: 'NonCoffee', categoryId: 1, sortOrder: 2, isActive: true },
    { id: 3, name: 'Snacks', categoryId: 2, sortOrder: 3, isActive: true },
    { id: 4, name: 'Retail', categoryId: 4, sortOrder: 4, isActive: true },
  ],
  addOnTypes: [
    { id: 1, name: 'Size', isRequired: true, minSelect: 1, maxSelect: 1, sortOrder: 1, isActive: true },
    { id: 2, name: 'Flavor', isRequired: true, minSelect: 1, maxSelect: 1, sortOrder: 2, isActive: true },
    { id: 5, name: 'Sauce', isRequired: false, minSelect: 0, maxSelect: 1, sortOrder: 3, isActive: true },
    { id: 3, name: 'Topping', isRequired: false, minSelect: 0, maxSelect: 0, sortOrder: 4, isActive: true },
    { id: 4, name: 'Extra', isRequired: false, minSelect: 0, maxSelect: 0, sortOrder: 5, isActive: true },
  ],
};
