import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import {
  previewRecipe,
  RecipePreviewItemLine,
  RecipePreviewOption,
  RecipePreviewOptionLink,
} from './recipe-preview';

interface RecipePreviewCase {
  name: string;
  price: number;
  suppliesCost: number;
  lines: Omit<RecipePreviewItemLine, 'itemName' | 'unitName'>[];
  options: (Omit<RecipePreviewOption, 'links'> & {
    links: Omit<RecipePreviewOptionLink, 'itemName' | 'unitName'>[];
  })[];
  chosen: Record<string, number>;
  expected: {
    price: number;
    totalCost: number;
    unknownCostCount: number;
    margin: number;
    addOnNames: string[];
    lines: { itemId: string; quantity: number; lineCost: number | null; sourceName: string | null }[];
    replacedItemNames: string[];
    warnings: string[];
  };
}

describe('recipe preview: the cases shared with the API', () => {
  it.each((cases.recipePreview as unknown as RecipePreviewCase[]).map((c) => [c.name, c] as const))(
    '%s',
    (_name, c) => {
      const result = previewRecipe({
        productId: 'drink',
        productName: 'Drink',
        price: c.price,
        suppliesCost: c.suppliesCost,
        lines: c.lines.map((line) => ({ ...line, itemName: line.itemId, unitName: 'ml' })),
        options: c.options.map((option) => ({
          ...option,
          links: option.links.map((link) => ({ ...link, itemName: link.itemId, unitName: 'ml' })),
        })),
        chosen: c.chosen,
      });

      expect(result.price).toBeCloseTo(c.expected.price, 6);
      expect(result.totalCost).toBeCloseTo(c.expected.totalCost, 6);
      expect(result.unknownCostCount).toBe(c.expected.unknownCostCount);
      expect(result.margin).toBeCloseTo(c.expected.margin, 6);
      expect(result.addOnNames).toEqual(c.expected.addOnNames);
      expect(
        result.lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          lineCost: line.lineCost,
          sourceName: line.sourceName,
        })),
      ).toEqual(c.expected.lines);
      expect(result.replacedItemNames).toEqual(c.expected.replacedItemNames);
      expect(result.warnings).toEqual(c.expected.warnings);
    },
  );
});
