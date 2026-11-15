import { PlanFeatureCatalog } from '@shared/calculations/plan-features';
import { describe, expect, it } from 'vitest';
import { REPORT_FEATURES, reportFeatureOf } from './report-features';

describe('report features', () => {
  it('only names features the plan catalog knows', () => {
    const keys = PlanFeatureCatalog.map((feature) => feature.key);

    for (const feature of Object.values(REPORT_FEATURES)) {
      expect(keys).toContain(feature);
    }
  });

  it('leaves a report with no plan feature open', () => {
    expect(reportFeatureOf('daily-sales')).toBeNull();
    expect(reportFeatureOf('waste')).toBe('inventory');
  });
});
