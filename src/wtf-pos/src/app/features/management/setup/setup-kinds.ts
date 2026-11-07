import { AuthService } from '@core/services';

export type SetupKindId = 'categories' | 'subcategories' | 'addon-types' | 'waste-reasons';

export interface SetupKind {
  readonly id: SetupKindId;
  readonly label: string;
  readonly group: string;
  readonly description: string;
  readonly canOpen: (auth: AuthService) => boolean;
}

export const SETUP_KINDS: readonly SetupKind[] = [
  {
    id: 'categories',
    label: 'Categories',
    group: 'Menu',
    description: 'The main groups products belong to',
    canOpen: (auth) => auth.canReadProducts(),
  },
  {
    id: 'subcategories',
    label: 'Sub-categories',
    group: 'Menu',
    description: 'The sections inside a category',
    canOpen: (auth) => auth.canReadProducts(),
  },
  {
    id: 'addon-types',
    label: 'Add-on Types',
    group: 'Menu',
    description: 'Sizes, flavors and other add-on groups with their rules',
    canOpen: (auth) => auth.canReadProducts(),
  },
  {
    id: 'waste-reasons',
    label: 'Waste Reasons',
    group: 'Inventory',
    description: 'The reasons staff choose when they record waste',
    canOpen: (auth) => auth.canManageWasteReasons(),
  },
];

export function visibleSetupKinds(auth: AuthService): SetupKind[] {
  return SETUP_KINDS.filter((kind) => kind.canOpen(auth));
}

export function isSetupKindId(value: string | null | undefined): value is SetupKindId {
  return SETUP_KINDS.some((kind) => kind.id === value);
}
