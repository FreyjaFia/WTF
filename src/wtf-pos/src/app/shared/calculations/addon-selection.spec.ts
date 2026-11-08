import cases from './calculation-cases.json';
import { isPickOne, selectionError, selectionLabel } from './addon-selection';

interface AddOnSelectionCase {
  name: string;
  typeName: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  selected: number;
  expectedError: string | null;
  expectedLabel: string;
}

describe('add-on selection rules (shared cases)', () => {
  const sample = cases.addOnSelection as AddOnSelectionCase[];

  it.each(sample.map((c) => [c.name, c] as const))('error: %s', (_name, c) => {
    const rule = {
      name: c.typeName,
      isRequired: c.isRequired,
      minSelect: c.minSelect,
      maxSelect: c.maxSelect,
    };
    expect(selectionError(rule, c.selected)).toBe(c.expectedError);
  });

  it.each(sample.map((c) => [c.name, c] as const))('label: %s', (_name, c) => {
    const rule = {
      name: c.typeName,
      isRequired: c.isRequired,
      minSelect: c.minSelect,
      maxSelect: c.maxSelect,
    };
    expect(selectionLabel(rule)).toBe(c.expectedLabel);
  });

  it('pick one means a maximum of one', () => {
    expect(isPickOne({ name: 'Size', isRequired: true, minSelect: 1, maxSelect: 1 })).toBe(true);
    expect(isPickOne({ name: 'Topping', isRequired: false, minSelect: 0, maxSelect: 0 })).toBe(false);
  });
});
