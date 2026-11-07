export interface AddOnTypeRule {
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
}

export function minimumSelection(rule: AddOnTypeRule): number {
  return rule.isRequired ? Math.max(rule.minSelect, 1) : Math.max(rule.minSelect, 0);
}

export function maximumSelection(rule: AddOnTypeRule): number {
  return rule.maxSelect > 0 ? rule.maxSelect : Number.POSITIVE_INFINITY;
}

export function isPickOne(rule: AddOnTypeRule): boolean {
  return rule.maxSelect === 1;
}

export function selectionError(rule: AddOnTypeRule, selected: number): string | null {
  const name = rule.name.trim().toLowerCase();
  const minimum = minimumSelection(rule);
  const maximum = maximumSelection(rule);

  if (minimum === 1 && rule.maxSelect === 1 && selected !== 1) {
    return `A ${name} selection is required and must be exactly one.`;
  }

  if (selected < minimum) {
    return `A ${name} selection is required: choose at least ${minimum}.`;
  }

  if (selected > maximum) {
    return maximum === 1
      ? `A ${name} selection must be at most one.`
      : `A ${name} selection must be at most ${maximum}.`;
  }

  return null;
}

export function selectionLabel(rule: AddOnTypeRule): string {
  const required = minimumSelection(rule) > 0 ? 'Required' : 'Optional';
  let how = 'Pick many';
  if (rule.maxSelect === 1) {
    how = 'Pick one';
  } else if (rule.maxSelect > 1) {
    how = `Pick up to ${rule.maxSelect}`;
  }

  return `${required} · ${how}`;
}

export interface AddOnGroupRuleSource {
  displayName: string;
  isRequired?: boolean;
  minSelect?: number;
  maxSelect?: number;
}

export function ruleOfGroup(group: AddOnGroupRuleSource): AddOnTypeRule {
  return {
    name: group.displayName,
    isRequired: group.isRequired ?? false,
    minSelect: group.minSelect ?? 0,
    maxSelect: group.maxSelect ?? 0,
  };
}
