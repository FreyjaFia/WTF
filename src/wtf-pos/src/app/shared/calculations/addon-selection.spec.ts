import cases from './calculation-cases.json';
import { isPickOne, presetSelections, selectionError, selectionLabel } from './addon-selection';

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

describe('presetSelections', () => {
  const temperature = (extra: object = {}, options = [{ id: 'hot' }, { id: 'iced' }]) => ({
    type: 6,
    displayName: 'Temperature',
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options,
    ...extra,
  });

  it('pre-selects the default option of a required pick-one group', () => {
    expect(presetSelections([temperature({ defaultAddOnId: 'iced' })])).toEqual([
      { type: 6, optionId: 'iced' },
    ]);
  });

  it('pre-selects nothing when a group with several options has no default', () => {
    expect(presetSelections([temperature()])).toEqual([]);
  });

  it('selects the only option of a required pick-one group', () => {
    expect(presetSelections([temperature({}, [{ id: 'iced' }])])).toEqual([
      { type: 6, optionId: 'iced' },
    ]);
  });

  it('ignores a default that is no longer offered and counts only active options', () => {
    expect(
      presetSelections([
        temperature({ defaultAddOnId: 'gone' }, [
          { id: 'hot', isActive: false } as { id: string },
          { id: 'iced' },
        ]),
      ]),
    ).toEqual([{ type: 6, optionId: 'iced' }]);
  });

  it('leaves optional and pick-many groups alone', () => {
    expect(
      presetSelections([
        temperature({ isRequired: false, minSelect: 0, defaultAddOnId: 'hot' }),
        temperature({ maxSelect: 0, defaultAddOnId: 'hot' }),
      ]),
    ).toEqual([]);
  });
});
