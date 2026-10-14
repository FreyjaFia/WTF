import { describe, expect, it } from 'vitest';
import { findReportDefinition, REPORT_DEFINITIONS, ReportContext } from './report-definitions';
import {
  buildCsv,
  cellText,
  filterAndSortRows,
  formatDateTimeText,
  formatMoneyText,
  hasTotalRow,
  totalCells,
} from './report-table';

describe('report table helpers', () => {
  const context: ReportContext = { groupBy: 'Day' };
  const payments = findReportDefinition('payments');
  const column = (key: string) => payments.columns.find((c) => c.key === key)!;

  const rows = [
    { paymentMethod: 'Cash', orderCount: 2, totalAmount: 150, totalPercent: 30 },
    { paymentMethod: 'GCash', orderCount: 1, totalAmount: 350, totalPercent: 70 },
    { paymentMethod: 'Card', orderCount: 5, totalAmount: 90, totalPercent: 18 },
  ];
  const methods = (result: { paymentMethod?: unknown }[]) => result.map((r) => r.paymentMethod);

  describe('cellText', () => {
    it('formats money, integers and percents', () => {
      expect(cellText(rows[1], column('totalAmount'), context)).toBe('350.00');
      expect(cellText({ orderCount: 12345 }, column('orderCount'), context)).toBe('12,345');
      expect(cellText(rows[1], column('totalPercent'), context)).toBe('70.00%');
    });

    it('shows a dash for missing values', () => {
      expect(cellText({ paymentMethod: null }, column('paymentMethod'), context)).toBe('-');
      expect(cellText({}, column('paymentMethod'), context)).toBe('-');
      expect(cellText({ paymentMethod: '' }, column('paymentMethod'), context)).toBe('-');
    });

    it('formats minutes rounded', () => {
      const links = findReportDefinition('customer-links');
      const minutes = links.columns.find((c) => c.format === 'minutes')!;
      expect(cellText({ [minutes.key]: 12.6 }, minutes, context)).toBe('13 min');
    });

    it('uses a column label function when there is one', () => {
      const hourly = findReportDefinition('hourly');
      const hour = hourly.columns[0];
      expect(cellText({ hour: 9 }, hour, context)).toBe('09:00 - 10:00');
    });

    it('shows a time sent with a trailing Z exactly as sent', () => {
      expect(formatDateTimeText('2026-10-14T15:00:00Z')).toMatch(/3:00\s?PM/i);
      expect(formatDateTimeText('2026-10-14T00:30:00Z')).toMatch(/12:30\s?AM/i);
    });

    it('shows the Z-suffixed date columns of the voids and customers reports as sent', () => {
      const voids = findReportDefinition('voids').columns.find((c) => c.key === 'orderedAt')!;
      const customers = findReportDefinition('customers').columns.find((c) => c.key === 'lastVisit')!;

      expect(cellText({ orderedAt: '2026-10-14T15:00:00Z' }, voids, context)).toMatch(/3:00\s?PM/i);
      expect(cellText({ lastVisit: '2026-10-14T15:00:00Z' }, customers, context)).toMatch(/3:00\s?PM/i);
    });

    it('formats dates and leaves unreadable ones alone', () => {
      expect(formatDateTimeText('not a date')).toBe('not a date');
      expect(formatDateTimeText('2026-03-10T12:00:00')).toContain('2026');
    });

    it('formats money with two decimals and thousands separators', () => {
      expect(formatMoneyText(1234.5)).toBe('1,234.50');
    });
  });

  describe('filterAndSortRows', () => {
    it('returns a copy in the original order when nothing is asked', () => {
      const result = filterAndSortRows(rows, payments, context, '', null, 'asc');

      expect(methods(result)).toEqual(['Cash', 'GCash', 'Card']);
      expect(result).not.toBe(rows);
    });

    it('searches every visible column case-insensitively on the shown text', () => {
      expect(methods(filterAndSortRows(rows, payments, context, 'GCASH', null, 'asc'))).toEqual(['GCash']);
      expect(methods(filterAndSortRows(rows, payments, context, '350.00', null, 'asc'))).toEqual(['GCash']);
      expect(methods(filterAndSortRows(rows, payments, context, '  card ', null, 'asc'))).toEqual(['Card']);
      expect(filterAndSortRows(rows, payments, context, 'zzz', null, 'asc')).toEqual([]);
    });

    it('sorts numbers ascending and descending', () => {
      expect(methods(filterAndSortRows(rows, payments, context, '', 'totalAmount', 'asc'))).toEqual([
        'Card',
        'Cash',
        'GCash',
      ]);
      expect(methods(filterAndSortRows(rows, payments, context, '', 'totalAmount', 'desc'))).toEqual([
        'GCash',
        'Cash',
        'Card',
      ]);
    });

    it('sorts text ignoring case', () => {
      const mixed = [{ paymentMethod: 'beta' }, { paymentMethod: 'Alpha' }, { paymentMethod: 'charlie' }];

      expect(methods(filterAndSortRows(mixed, payments, context, '', 'paymentMethod', 'asc'))).toEqual([
        'Alpha',
        'beta',
        'charlie',
      ]);
    });

    it('puts missing values first when ascending', () => {
      const withGap = [{ paymentMethod: 'B', orderCount: 2 }, { paymentMethod: 'A', orderCount: null }];

      expect(methods(filterAndSortRows(withGap, payments, context, '', 'orderCount', 'asc'))).toEqual(['A', 'B']);
    });

    it('sorts dates by time', () => {
      const customers = findReportDefinition('customers');
      const data = [
        { customerName: 'Late', lastVisit: '2026-03-12T10:00:00' },
        { customerName: 'Early', lastVisit: '2026-03-02T10:00:00' },
      ];

      const result = filterAndSortRows(data, customers, context, '', 'lastVisit', 'asc');

      expect(result.map((r) => r['customerName'])).toEqual(['Early', 'Late']);
    });

    it('ignores an unknown sort key and does not change the input', () => {
      const input = [...rows];

      const result = filterAndSortRows(input, payments, context, '', 'nope', 'desc');

      expect(methods(result)).toEqual(['Cash', 'GCash', 'Card']);
      expect(input).toEqual(rows);
    });
  });

  describe('buildCsv', () => {
    const header = 'Payment Method,Orders,Gross,Discount,Refunded,Net,Net %';

    it('writes a header, one line per row and a Total line, with CRLF line ends', () => {
      const csv = buildCsv(
        [{ paymentMethod: 'Cash', orderCount: 2, grossSales: 200, discounts: 30, refundedAmount: 20, totalAmount: 150, totalPercent: 100 }],
        payments,
        context,
      );

      expect(csv).toBe(
        `${header}\r\nCash,2,200.00,30.00,20.00,150.00,100.00%\r\nTotal,2,200.00,30.00,20.00,150.00,100.00%`,
      );
    });

    it('writes only the header for no rows, with no Total line', () => {
      expect(buildCsv([], payments, context)).toBe(header);
    });

    it('quotes commas, quotes and line breaks', () => {
      const csv = buildCsv(
        [{ paymentMethod: 'A, "B"\nC', orderCount: 1, totalAmount: 1, totalPercent: 1 }],
        payments,
        context,
      );

      expect(csv).toContain('"A, ""B""\nC"');
    });

    it('quotes numbers that contain a thousands comma', () => {
      const csv = buildCsv(
        [{ paymentMethod: 'Cash', orderCount: 1, totalAmount: 1234.5, totalPercent: 1 }],
        payments,
        context,
      );

      expect(csv).toContain('"1,234.50"');
    });

    it('prefixes text that a spreadsheet would run as a formula', () => {
      const csv = buildCsv(
        [
          { paymentMethod: '=HYPERLINK("http://x")', orderCount: 1, totalAmount: 1, totalPercent: 1 },
          { paymentMethod: '+1', orderCount: 1, totalAmount: 1, totalPercent: 1 },
          { paymentMethod: '-cmd', orderCount: 1, totalAmount: 1, totalPercent: 1 },
          { paymentMethod: '@SUM(A1)', orderCount: 1, totalAmount: 1, totalPercent: 1 },
        ],
        payments,
        context,
      );

      const lines = csv.split('\r\n');
      expect(lines[1].startsWith('"\'=HYPERLINK(""http://x"")"')).toBe(true);
      expect(lines[2].startsWith("'+1,")).toBe(true);
      expect(lines[3].startsWith("'-cmd,")).toBe(true);
      expect(lines[4].startsWith("'@SUM(A1),")).toBe(true);
    });

    it('writes the missing-value dash as a plain dash, not a quoted one', () => {
      const csv = buildCsv(
        [{ paymentMethod: 'Cash', orderCount: 1, grossSales: null, discounts: undefined, refundedAmount: '', totalAmount: 5, totalPercent: 5 }],
        payments,
        context,
      );

      expect(csv.split('\r\n')[1]).toBe('Cash,1,-,-,-,5.00,5.00%');
    });

    it('still guards text that starts with a dash and more', () => {
      const csv = buildCsv(
        [{ paymentMethod: '-1+1', orderCount: 1, totalAmount: 5, totalPercent: 5 }],
        payments,
        context,
      );

      expect(csv).toContain("'-1+1");
    });

    it('leaves negative numbers alone', () => {
      const daily = findReportDefinition('daily-sales');
      const csv = buildCsv(
        [{ periodStart: 'x', grossSales: 0, refundedAmount: 0, netSales: -5, orderCount: 0 }],
        daily,
        context,
      );

      expect(csv).toContain(',-5.00,');
      expect(csv).not.toContain("'-5.00");
    });
  });
});

describe('report total rows', () => {
  const context: ReportContext = { groupBy: 'Day' };
  const payments = findReportDefinition('payments');
  const money = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const rows = [
    { paymentMethod: 'Cash', orderCount: 2, grossSales: 200, discounts: 30, refundedAmount: 20, totalAmount: 150, totalPercent: 60 },
    { paymentMethod: 'GCash', orderCount: 1, grossSales: 100, discounts: 0, refundedAmount: 0, totalAmount: 100, totalPercent: 40 },
  ];

  it('has a total row for reports with summable columns', () => {
    expect(hasTotalRow(payments)).toBe(true);
    expect(hasTotalRow(findReportDefinition('stock-status'))).toBe(true);
  });

  it('has no total row for the daily close, whose rows are sections', () => {
    const close = findReportDefinition('daily-close');

    expect(hasTotalRow(close)).toBe(false);
    expect(totalCells([{ section: 'Sales', label: 'x', amount: 1, orderCount: 1 }], close)).toBeNull();
  });

  it('has no total row when there are no rows', () => {
    expect(totalCells([], payments)).toBeNull();
  });

  it('labels the first column Total and sums every summable column', () => {
    const cells = totalCells(rows, payments)!;

    expect(cells).toEqual(['Total', '3', '300.00', '30.00', '20.00', '250.00', '100.00%']);
  });

  it('keeps gross - discount - refunded = net in the total, as in each row', () => {
    const [, , gross, discount, refunded, net] = totalCells(rows, payments)!.map((c) => Number(c.replace(/[,%]/g, '')));

    expect(gross - discount - refunded).toBe(net);
    expect(money(gross - discount - refunded)).toBe(money(250));
  });

  it('totals only the rows given, so a search changes it', () => {
    const shown = filterAndSortRows(rows, payments, context, 'gcash', null, 'asc');

    expect(totalCells(shown, payments)![5]).toBe('100.00');
  });

  it('averages as total amount over total count, never the average of averages', () => {
    const staff = findReportDefinition('staff');
    const data = [
      { staffName: 'A', orderCount: 1, totalRevenue: 100, averageOrderValue: 100 },
      { staffName: 'B', orderCount: 3, totalRevenue: 100, averageOrderValue: 33.33 },
    ];
    const index = staff.columns.findIndex((c) => c.key === 'averageOrderValue');

    expect(totalCells(data, staff)![index]).toBe('50.00');
  });

  it('adds the total line to the CSV', () => {
    const csv = buildCsv(rows, payments, context).split('\r\n');

    expect(csv.length).toBe(4);
    expect(csv[3].startsWith('Total,3,')).toBe(true);
  });

  it.each(REPORT_DEFINITIONS.filter((d) => d.columns.some((c) => c.key === 'grossSales')).map((d) => [d.type, d] as const))(
    '%s: the step columns are gross, discount, refunded and then net',
    (_type, definition) => {
      const keys = definition.columns.map((c) => c.key);
      const gross = keys.indexOf('grossSales');

      expect(keys.slice(gross, gross + 3)).toEqual(['grossSales', 'discounts', 'refundedAmount']);
      expect(['netSales', 'revenue', 'totalAmount', 'totalRevenue']).toContain(keys[gross + 3] ?? keys[gross + 2]);
    },
  );
});
