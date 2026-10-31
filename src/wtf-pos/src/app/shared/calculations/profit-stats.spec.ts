import { describe, expect, it } from 'vitest';
import { marginPercentOf, summarizeProfit } from './profit-stats';

const known = { revenue: 300, cost: 100, grossProfit: 200, costStatus: 'Known' };
const partly = { revenue: 100, cost: 30, grossProfit: null, costStatus: 'Partly known' };
const none = { revenue: 50, cost: null, grossProfit: null, costStatus: 'No cost' };

describe('profit stats', () => {
  it('adds cost and profit only from rows that have them', () => {
    const summary = summarizeProfit([known, partly, none]);
    expect(summary.revenue).toBe(450);
    expect(summary.cost).toBe(130);
    expect(summary.grossProfit).toBe(200);
    expect(summary.rowsWithoutFullCost).toBe(2);
  });

  it('works the margin over the net of rows that have a profit', () => {
    expect(marginPercentOf([known, partly, none])).toBeCloseTo(66.6667, 3);
  });

  it('has no margin when no row has a profit or the net is zero', () => {
    expect(marginPercentOf([partly, none])).toBeNull();
    expect(marginPercentOf([])).toBeNull();
    expect(
      marginPercentOf([{ revenue: 0, cost: 0, grossProfit: 0, costStatus: 'Known' }]),
    ).toBeNull();
  });

  it('keeps negative profit', () => {
    const loss = { revenue: 10, cost: 25.5, grossProfit: -15.5, costStatus: 'Known' };
    expect(summarizeProfit([loss]).grossProfit).toBe(-15.5);
    expect(marginPercentOf([loss])).toBeCloseTo(-155, 3);
  });
});
