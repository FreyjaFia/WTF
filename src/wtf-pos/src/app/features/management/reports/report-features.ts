import type { PlanFeatureKey } from '@shared/calculations/plan-features';
import { ReportType } from '@shared/models';

export const REPORT_FEATURES: Readonly<Partial<Record<ReportType, PlanFeatureKey>>> = {
  'stock-status': 'inventory',
  waste: 'inventory',
  'stock-variance': 'inventory',
  'gross-profit': 'inventory',
  'profit-loss': 'inventory',
  promotions: 'promotions',
  'customer-links': 'orderlinks',
};

export function reportFeatureOf(type: ReportType): PlanFeatureKey | null {
  return REPORT_FEATURES[type] ?? null;
}
