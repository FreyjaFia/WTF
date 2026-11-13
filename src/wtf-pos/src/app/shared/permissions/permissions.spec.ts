import { PlanFeatureCatalog } from '@shared/calculations/plan-features';
import { describe, expect, it } from 'vitest';
import { PermissionCatalog, Permissions, SystemRolePermissions, keepReadPermissions } from './permissions';

describe('permission catalog', () => {
  const keys = PermissionCatalog.map((p) => p.key);
  const features = ['core', ...PlanFeatureCatalog.map((f) => f.key)];

  it('has unique, lower-case keys that match the Permissions constants', () => {
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k === k.toLowerCase())).toBe(true);
    expect([...keys].sort()).toEqual(Object.values(Permissions).sort());
  });

  it('gives every permission an area, a label and a known feature', () => {
    for (const p of PermissionCatalog) {
      expect(p.area, p.key).toBeTruthy();
      expect(p.label, p.key).toBeTruthy();
      expect(features, p.key).toContain(p.feature);
    }
  });

  it('only requires keys that exist', () => {
    for (const p of PermissionCatalog) {
      for (const required of p.requires) {
        expect(keys, p.key).toContain(required);
      }
    }
  });

  it('gives every system role only catalog keys, each with the keys it requires', () => {
    for (const [role, held] of Object.entries(SystemRolePermissions)) {
      for (const key of held) {
        const definition = PermissionCatalog.find((p) => p.key === key);
        expect(definition, `${role} ${key}`).toBeTruthy();
        for (const required of definition?.requires ?? []) {
          expect(held, `${role} holds ${key} without ${required}`).toContain(required);
        }
      }
    }
  });
});

describe('keepReadPermissions', () => {
  it('keeps only the keys that look at things', () => {
    const kept = keepReadPermissions(Object.values(Permissions));

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((key) => key.endsWith('.read'))).toBe(true);
    expect(kept).toContain(Permissions.OrdersRead);
    expect(kept).not.toContain(Permissions.OrdersWrite);
    expect(kept).not.toContain(Permissions.RolesManage);
    expect(kept).not.toContain(Permissions.SubscriptionBilling);
  });
});
