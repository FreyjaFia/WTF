import { describe, expect, it } from 'vitest';
import { userRoleLabel } from './user-role-label';

describe('userRoleLabel', () => {
  it('prefers the role name the API sends, with spaces between words', () => {
    expect(userRoleLabel({ roleId: 100, roleName: 'Shift Lead' })).toBe('Shift Lead');
    expect(userRoleLabel({ roleId: 3, roleName: 'AdminViewer' })).toBe('Admin Viewer');
  });

  it('falls back to the built-in role names when there is no role name', () => {
    expect(userRoleLabel({ roleId: 4 })).toBe('Owner');
    expect(userRoleLabel({ roleId: 6, roleName: null })).toBe('Stock Manager');
  });

  it('says Unknown for a role it cannot name', () => {
    expect(userRoleLabel({ roleId: 999 })).toBe('Unknown');
  });
});
