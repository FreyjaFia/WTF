import { sumAmounts } from './money';
import { percentOfTotal } from './sales-stats';

export interface ProfitRow {
  revenue: number;
  cost?: number | null;
  grossProfit?: number | null;
  costStatus: string;
}

export interface ProfitSummary {
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPercent: number | null;
  rowsWithoutFullCost: number;
}

export function marginPercentOf(rows: readonly ProfitRow[]): number | null {
  const withProfit = rows.filter((row) => row.grossProfit != null);
  if (withProfit.length === 0) {
    return null;
  }

  const revenue = sumAmounts(withProfit.map((row) => row.revenue));
  if (revenue <= 0) {
    return null;
  }

  return percentOfTotal(sumAmounts(withProfit.map((row) => row.grossProfit ?? 0)), revenue);
}

export function summarizeProfit(rows: readonly ProfitRow[]): ProfitSummary {
  const revenue = sumAmounts(rows.map((row) => row.revenue));
  const cost = sumAmounts(rows.map((row) => row.cost ?? 0));
  return {
    revenue,
    cost,
    grossProfit: sumAmounts(rows.map((row) => row.grossProfit ?? 0)),
    marginPercent: marginPercentOf(rows),
    rowsWithoutFullCost: rows.filter((row) => row.costStatus !== 'Known').length,
  };
}
