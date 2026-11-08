import { AuthService } from '@core/services';
import { isSetupKindId, SETUP_KINDS, visibleSetupKinds } from './setup-kinds';

function authWith(products: boolean, waste: boolean, stock = false): AuthService {
  return {
    canReadProducts: () => products,
    canManageWasteReasons: () => waste,
    canReadStockMovements: () => stock,
  } as unknown as AuthService;
}

describe('setup kinds', () => {
  it('lists the kinds in order', () => {
    expect(SETUP_KINDS.map((k) => k.id)).toEqual([
      'categories',
      'subcategories',
      'addon-types',
      'waste-reasons',
      'suppliers',
    ]);
  });

  it('shows every kind to a role that can read products, manage waste reasons and read stock', () => {
    expect(visibleSetupKinds(authWith(true, true, true))).toHaveLength(5);
  });

  it('hides waste reasons from a role that cannot manage them', () => {
    const ids = visibleSetupKinds(authWith(true, false, true)).map((k) => k.id);
    expect(ids).toEqual(['categories', 'subcategories', 'addon-types', 'suppliers']);
  });

  it('shows a stock manager only the suppliers list', () => {
    const ids = visibleSetupKinds(authWith(false, false, true)).map((k) => k.id);
    expect(ids).toEqual(['suppliers']);
  });

  it('shows nothing to a role with no permission', () => {
    expect(visibleSetupKinds(authWith(false, false, false))).toEqual([]);
  });

  it('recognises kind ids', () => {
    expect(isSetupKindId('waste-reasons')).toBe(true);
    expect(isSetupKindId('suppliers')).toBe(true);
    expect(isSetupKindId('nope')).toBe(false);
    expect(isSetupKindId(null)).toBe(false);
  });
});
