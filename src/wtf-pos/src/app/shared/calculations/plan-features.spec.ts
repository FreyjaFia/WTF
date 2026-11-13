import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import {
  normalizeFeatures,
  PlanFeatureCatalog,
  plansContaining,
  serializeFeatures,
  splitFeatureText,
  toggleFeature,
  unknownFeatures,
} from './plan-features';

interface FeatureCase {
  name: string;
  text: string | null;
  expected: string[];
  unknown: string[];
}

interface ContainingCase {
  name: string;
  feature: string;
  plans: { name: string; features: string }[];
  expected: string[];
}

describe('plan features: the cases shared with the API', () => {
  it('the catalog matches the shared file', () => {
    expect(PlanFeatureCatalog).toEqual(cases.planFeatureCatalog);
  });

  it.each((cases.planFeatures as FeatureCase[]).map((c) => [c.name, c] as const))(
    'normalize: %s',
    (_name, c) => {
      const words = splitFeatureText(c.text);
      expect(normalizeFeatures(words)).toEqual(c.expected);
      expect(unknownFeatures(words)).toEqual(c.unknown);
      expect(serializeFeatures(words)).toBe(c.expected.join(','));
    },
  );

  it('ticking a feature ticks what it needs', () => {
    expect(toggleFeature([], 'purchasing', true)).toEqual(['inventory', 'purchasing']);
    expect(toggleFeature(['audit'], 'chat', true)).toEqual(['orderlinks', 'chat', 'audit']);
  });

  it('unticking a feature unticks what needs it', () => {
    expect(toggleFeature(['inventory', 'purchasing', 'audit'], 'inventory', false)).toEqual(['audit']);
    expect(toggleFeature(['inventory', 'purchasing'], 'purchasing', false)).toEqual(['inventory']);
  });

  it.each((cases.plansContaining as ContainingCase[]).map((c) => [c.name, c] as const))(
    'plans containing: %s',
    (_name, c) => {
      expect(plansContaining(c.feature, c.plans)).toEqual(c.expected);
    },
  );
});
