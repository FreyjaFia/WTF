export interface PlanFeatureDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  readonly needs: readonly string[];
}

export const CORE_FEATURE = 'core';

export const PlanFeatureCatalog: readonly PlanFeatureDefinition[] = [
  { key: 'expenses', label: 'Expenses', description: 'Record and review shop expenses.', group: 'Money', needs: [] },
  { key: 'inventory', label: 'Inventory', description: 'Items, stock, counts, waste and costs.', group: 'Stock', needs: [] },
  { key: 'purchasing', label: 'Purchasing', description: 'Suppliers, reorder list, purchase orders and receiving.', group: 'Stock', needs: ['inventory'] },
  { key: 'promotions', label: 'Promotions', description: 'Discounts and deals on the register.', group: 'Sell more', needs: [] },
  { key: 'orderlinks', label: 'Order links', description: 'Customer ordering links.', group: 'Customer ordering', needs: [] },
  { key: 'chat', label: 'Order chat', description: 'Chat with customers about their orders.', group: 'Customer ordering', needs: ['orderlinks'] },
  { key: 'workbook', label: 'Monthly workbook', description: 'The monthly Excel report workbook.', group: 'Insight', needs: [] },
  { key: 'audit', label: 'Audit log', description: 'See who changed what.', group: 'Control', needs: [] },
  { key: 'customroles', label: 'Custom roles', description: 'Create your own roles and choose what each can do.', group: 'Control', needs: [] },
];

export function isKnownFeature(key: string): boolean {
  return PlanFeatureCatalog.some((f) => f.key === key.toLowerCase());
}

export function splitFeatureText(text: string | null | undefined): string[] {
  return (text ?? '').split(/[,;\s]+/).filter((word) => word.length > 0);
}

export function normalizeFeatures(words: readonly string[]): string[] {
  const wanted = new Set<string>();
  const pending = words.map((w) => w.toLowerCase()).filter(isKnownFeature);

  while (pending.length > 0) {
    const key = pending.pop()!;
    if (wanted.has(key)) {
      continue;
    }

    wanted.add(key);
    pending.push(...(PlanFeatureCatalog.find((f) => f.key === key)?.needs ?? []));
  }

  return PlanFeatureCatalog.filter((f) => wanted.has(f.key)).map((f) => f.key);
}

export function unknownFeatures(words: readonly string[]): string[] {
  return Array.from(new Set(words.filter((w) => !isKnownFeature(w)).map((w) => w.toLowerCase())));
}

export function serializeFeatures(words: readonly string[]): string {
  return normalizeFeatures(words).join(',');
}

// Ticking a feature ticks what it needs; unticking one unticks everything that needs it.
export function toggleFeature(
  selected: readonly string[],
  key: string,
  checked: boolean,
  catalog: readonly PlanFeatureDefinition[] = PlanFeatureCatalog,
): string[] {
  if (checked) {
    const wanted = new Set<string>([...selected, key]);
    const pending = [key];

    while (pending.length > 0) {
      const current = pending.pop();
      const needs = catalog.find((f) => f.key === current)?.needs ?? [];
      needs.filter((need) => !wanted.has(need)).forEach((need) => {
        wanted.add(need);
        pending.push(need);
      });
    }

    return catalog.filter((f) => wanted.has(f.key)).map((f) => f.key);
  }

  const remaining = new Set(selected.filter((k) => k !== key));
  let changed = true;

  while (changed) {
    changed = false;

    for (const feature of catalog) {
      if (remaining.has(feature.key) && feature.needs.some((need) => !remaining.has(need))) {
        remaining.delete(feature.key);
        changed = true;
      }
    }
  }

  return catalog.filter((f) => remaining.has(f.key)).map((f) => f.key);
}

export function plansContaining(
  feature: string,
  plans: readonly { name: string; features: string | null }[],
): string[] {
  return plans
    .filter((p) => feature === CORE_FEATURE || normalizeFeatures(splitFeatureText(p.features)).includes(feature))
    .map((p) => p.name);
}
