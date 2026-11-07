import { AuthService } from '@core/services';
import { isSetupKindId, SETUP_KINDS, visibleSetupKinds } from './setup-kinds';

function authWith(products: boolean, waste: boolean): AuthService {
  return {
    canReadProducts: () => products,
    canManageWasteReasons: () => waste,
  } as unknown as AuthService;
}

describe('setup kinds', () => {
  it('lists the four kinds in order', () => {
    expect(SETUP_KINDS.map((k) => k.id)).toEqual([
      'categories',
      'subcategories',
      'addon-types',
      'waste-reasons',
    ]);
  });

  it('shows every kind to a role that can read products and manage waste reasons', () => {
    expect(visibleSetupKinds(authWith(true, true))).toHaveLength(4);
  });

  it('hides waste reasons from a role that cannot manage them', () => {
    const ids = visibleSetupKinds(authWith(true, false)).map((k) => k.id);
    expect(ids).toEqual(['categories', 'subcategories', 'addon-types']);
  });

  it('shows nothing to a role with neither permission', () => {
    expect(visibleSetupKinds(authWith(false, false))).toEqual([]);
  });

  it('recognises kind ids', () => {
    expect(isSetupKindId('waste-reasons')).toBe(true);
    expect(isSetupKindId('nope')).toBe(false);
    expect(isSetupKindId(null)).toBe(false);
  });
});
