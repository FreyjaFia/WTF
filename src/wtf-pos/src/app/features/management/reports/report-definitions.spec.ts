import { describe, expect, it } from 'vitest';
import {
  REPORT_DEFINITIONS,
  REPORT_GROUPS,
  ReportRow,
  findReportDefinition,
  formatDecimal,
  hourRangeLabel,
  parseShopLocal,
  periodHeader,
  periodLabel,
} from './report-definitions';

const ALL_TYPES = [
  'daily-close',
  'daily-sales',
  'payments',
  'hourly',
  'product-sales',
  'promotions',
  'staff',
  'customers',
  'voids',
  'customer-links',
  'stock-status',
  'category-sales',
];

const totalsOf = (type: string, rows: ReportRow[]): Record<string, number> =>
  Object.fromEntries(
    findReportDefinition(type as never)
      .totals(rows)
      .map((t) => [t.label, t.value]),
  );

describe('report definitions', () => {
  it('defines every report type exactly once', () => {
    expect(REPORT_DEFINITIONS.map((d) => d.type).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('puts every report in a known group', () => {
    const groups = REPORT_GROUPS.map((g) => g.group);
    expect(REPORT_DEFINITIONS.every((d) => groups.includes(d.group))).toBe(true);
    expect(REPORT_GROUPS.every((g) => REPORT_DEFINITIONS.some((d) => d.group === g.group))).toBe(true);
  });

  describe.each(REPORT_DEFINITIONS.map((d) => [d.type, d] as const))('%s', (_type, definition) => {
    it('has a title, description, icon and columns with unique keys', () => {
      expect(definition.title).not.toBe('');
      expect(definition.description).not.toBe('');
      expect(definition.icon).not.toBe('');
      expect(definition.columns.length).toBeGreaterThan(0);
      const keys = definition.columns.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(definition.columns.every((c) => c.header.length > 0)).toBe(true);
    });

    it('sorts by one of its own columns by default', () => {
      if (definition.defaultSort) {
        expect(definition.columns.map((c) => c.key)).toContain(definition.defaultSort.key);
      }
    });

    it('right-aligns numeric columns only', () => {
      for (const column of definition.columns) {
        if (column.format === 'money' || column.format === 'integer') {
          expect(column.align).toBe('end');
        }
      }
    });

    it('has totals that are finite numbers even with no rows', () => {
      const totals = definition.totals([]);
      expect(totals.length).toBeGreaterThan(0);
      for (const total of totals) {
        expect(Number.isFinite(total.value)).toBe(true);
        expect(total.value).toBe(0);
      }
    });

    it('draws an empty chart from no rows', () => {
      if (definition.chart) {
        expect(definition.chart.points([], { groupBy: 'Day' })).toEqual([]);
      }
    });
  });

  it('only the stock report ignores the date range', () => {
    const noDates = REPORT_DEFINITIONS.filter((d) => !d.usesDateRange).map((d) => d.type);
    expect(noDates).toEqual(['stock-status']);
  });

  it('the customer link report has no source filter of its own', () => {
    expect(findReportDefinition('customer-links').usesSource).toBe(false);
  });

  it('falls back to daily sales for an unknown type', () => {
    expect(findReportDefinition('nope' as never).type).toBe('daily-sales');
  });

  describe('totals', () => {
    it('daily sales adds gross, refunded and net, and averages net over orders', () => {
      const totals = totalsOf('daily-sales', [
        { grossSales: 300, refundedAmount: 50, netSales: 250, orderCount: 2, tipsTotal: 5 },
        { grossSales: 150, refundedAmount: 0, netSales: 150, orderCount: 3, tipsTotal: 0.1 },
      ]);

      expect(totals['Gross Sales']).toBe(450);
      expect(totals['Refunded']).toBe(50);
      expect(totals['Net Sales']).toBe(400);
      expect(totals['Orders']).toBe(5);
      expect(totals['Avg/Order']).toBe(80);
      expect(totals['Tips']).toBe(5.1);
    });

    it('daily close reads its headline figures from the Sales section only', () => {
      const totals = totalsOf('daily-close', [
        { section: 'Sales', label: 'Gross sales', amount: 350 },
        { section: 'Sales', label: 'Refunds', amount: 50 },
        { section: 'Sales', label: 'Net sales', amount: 300 },
        { section: 'Sales', label: 'Tips', amount: 10 },
        { section: 'Payments', label: 'Net sales', amount: 999 },
      ]);

      expect(totals['Gross Sales']).toBe(350);
      expect(totals['Refunds']).toBe(50);
      expect(totals['Net Sales']).toBe(300);
      expect(totals['Tips']).toBe(10);
    });

    it('payments adds the amounts and orders', () => {
      const totals = totalsOf('payments', [
        { paymentMethod: 'Cash', orderCount: 2, totalAmount: 150.1, totalPercent: 30 },
        { paymentMethod: 'GCash', orderCount: 1, totalAmount: 349.9, totalPercent: 70 },
      ]);

      expect(totals['Total Amount']).toBe(500);
      expect(totals['Orders']).toBe(3);
    });

    it('hourly finds the busiest hour', () => {
      const totals = totalsOf('hourly', [
        { hour: 8, orderCount: 1, revenue: 100 },
        { hour: 9, orderCount: 4, revenue: 400 },
        { hour: 10, orderCount: 2, revenue: 200 },
      ]);

      expect(totals['Total Revenue']).toBe(700);
      expect(totals['Peak Hour Revenue']).toBe(400);
    });

    it('stock status counts out of stock and low items and values the stock', () => {
      const totals = totalsOf('stock-status', [
        { status: 'Out of stock', stockValue: 0 },
        { status: 'Critical', stockValue: 10 },
        { status: 'Warning', stockValue: 20 },
        { status: 'OK', stockValue: 70 },
      ]);

      expect(totals['Items']).toBe(4);
      expect(totals['Out of Stock']).toBe(1);
      expect(totals['Critical/Warning']).toBe(2);
      expect(totals['Stock Value']).toBe(100);
    });
  });

  describe('labels', () => {
    it('reads a time with a trailing Z as shop-local, whatever the machine zone', () => {
      const parsed = parseShopLocal('2026-10-14T15:00:00Z');

      expect(parsed.getHours()).toBe(15);
      expect(parsed.getDate()).toBe(14);
      expect(parseShopLocal('2026-10-14T15:00:00').getHours()).toBe(15);
    });

    it('labels a period start sent with a Z as the same day', () => {
      expect(periodLabel('2026-10-14T00:00:00Z', 'Day')).toContain('October 14');
      expect(periodLabel('2026-10-14T00:00:00Z', 'Month')).toContain('October');
    });

    it('keeps charts to the top rows with short labels', () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        productName: 'A very long product name ' + i,
        revenue: 100 - i,
      }));
      const points = findReportDefinition('product-sales').chart!.points(rows, { groupBy: 'Day' });

      expect(points.length).toBeLessThanOrEqual(6);
      expect(points.every((p) => p.label.length <= 14)).toBe(true);
    });

    it('formats an hour range and wraps at midnight', () => {
      expect(hourRangeLabel(8)).toBe('08:00 - 09:00');
      expect(hourRangeLabel(23)).toBe('23:00 - 00:00');
    });

    it('names the period column after the grouping', () => {
      expect(periodHeader('Day')).toBe('Date');
      expect(periodHeader('Week')).toBe('Week');
      expect(periodHeader('Month')).toBe('Month');
    });

    it('gives back text it cannot read as a date', () => {
      expect(periodLabel('not a date', 'Day')).toBe('not a date');
    });

    it('labels days, weeks and months', () => {
      expect(periodLabel('2026-10-14T00:00:00', 'Day')).toContain('2026');
      expect(periodLabel('2026-10-12T00:00:00', 'Week')).toContain(' - ');
      expect(periodLabel('2026-10-01T00:00:00', 'Month')).toMatch(/2026/);
      expect(periodLabel('2026-10-01T00:00:00', 'Month')).not.toContain(' - ');
    });

    it('formats decimals with two places', () => {
      expect(formatDecimal(1234.5)).toBe('1,234.50');
      expect(formatDecimal(0)).toBe('0.00');
    });
  });
});
