import { average, sumAmounts } from '@shared/calculations';
import {
  CategorySalesReportRowDto,
  CustomerLinkReportRowDto,
  CustomerReportRowDto,
  DailyCloseReportRowDto,
  DailySalesReportRowDto,
  HourlySalesReportRowDto,
  PaymentsReportRowDto,
  ProductSalesReportRowDto,
  PromotionPerformanceReportRowDto,
  ReportGroupBy,
  ReportSortDirection,
  ReportType,
  StaffPerformanceReportRowDto,
  StockStatusReportRowDto,
  VoidedOrderReportRowDto,
} from '@shared/models';

export type ReportRow = Record<string, unknown>;

export type ColumnFormat =
  | 'text'
  | 'money'
  | 'integer'
  | 'decimal'
  | 'percent'
  | 'dateTime'
  | 'minutes';

export type ReportGroup = 'Sales' | 'Products' | 'Staff' | 'Customers' | 'Operations' | 'Inventory';

export type ReportFilterKind = 'groupBy' | 'productCategory' | 'staff' | 'splitAddOns';

export interface ReportContext {
  groupBy: ReportGroupBy;
}

export interface ReportColumn {
  key: string;
  header: string;
  format: ColumnFormat;
  align?: 'start' | 'end';
  label?: (row: ReportRow, context: ReportContext) => string;
  total?: (rows: readonly ReportRow[]) => number | null;
  lowPriority?: boolean;
}

export interface ReportTotal {
  label: string;
  value: number;
  format: 'money' | 'integer' | 'percent';
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ReportChart {
  kind: 'bar' | 'area' | 'donut';
  title: string;
  points: (rows: readonly ReportRow[], context: ReportContext) => ChartPoint[];
}

export interface ReportDefinition {
  type: ReportType;
  title: string;
  description: string;
  group: ReportGroup;
  icon: string;
  columns: readonly ReportColumn[];
  defaultSort: { key: string; direction: ReportSortDirection } | null;
  filters: readonly ReportFilterKind[];
  usesDateRange: boolean;
  usesSource: boolean;
  totals: (rows: readonly ReportRow[]) => ReportTotal[];
  chart?: ReportChart;
}

export interface ReportGroupSection {
  group: ReportGroup;
  description: string;
}

export const REPORT_GROUPS: readonly ReportGroupSection[] = [
  { group: 'Sales', description: 'Revenue, payments and the daily close' },
  { group: 'Products', description: 'What sells and which promotions work' },
  { group: 'Staff', description: 'Who took the orders' },
  { group: 'Customers', description: 'Who buys and how often' },
  { group: 'Operations', description: 'Voids, refunds and online orders' },
  { group: 'Inventory', description: 'Stock on hand' },
];

const STEP_GROSS: ReportColumn = {
  key: 'grossSales',
  header: 'Gross',
  format: 'money',
  align: 'end',
};
const STEP_DISCOUNT: ReportColumn = {
  key: 'discounts',
  header: 'Discount',
  format: 'money',
  align: 'end',
};
const STEP_REFUNDED: ReportColumn = {
  key: 'refundedAmount',
  header: 'Refunded',
  format: 'money',
  align: 'end',
};

const TOP_CHART_ROWS = 6;
const CHART_LABEL_LENGTH = 14;

function rowsOf<T>(rows: readonly ReportRow[]): T[] {
  return rows as unknown as T[];
}

function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  return sumAmounts(rows.map(pick));
}

function count<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function shortLabel(text: string): string {
  return text.length > CHART_LABEL_LENGTH ? `${text.slice(0, CHART_LABEL_LENGTH - 1)}.` : text;
}

function hourLabel(hour: number): string {
  if (hour === 0) {
    return '12a';
  }

  if (hour < 12) {
    return `${hour}a`;
  }

  return hour === 12 ? '12p' : `${hour - 12}p`;
}

// The API sends shop-local times without a zone and the UTC interceptor appends "Z"; drop it so they show as sent.
export function parseShopLocal(value: string): Date {
  return new Date(value.replace(/Z$/, ''));
}

export function hourRangeLabel(hour: number): string {
  const next = (hour + 1) % 24;
  return `${String(hour).padStart(2, '0')}:00 - ${String(next).padStart(2, '0')}:00`;
}

export function periodLabel(periodStart: string, groupBy: ReportGroupBy): string {
  const start = parseShopLocal(periodStart);
  if (Number.isNaN(start.getTime())) {
    return periodStart;
  }

  if (groupBy === 'Week') {
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startLabel = start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    const endLabel = end.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startLabel} - ${endLabel}`;
  }

  if (groupBy === 'Month') {
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  const dateLabel = start.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `${dateLabel} (${start.toLocaleDateString(undefined, { weekday: 'short' })})`;
}

export function periodHeader(groupBy: ReportGroupBy): string {
  if (groupBy === 'Week') {
    return 'Week';
  }

  return groupBy === 'Month' ? 'Month' : 'Date';
}

const dailySales: ReportDefinition = {
  type: 'daily-sales',
  title: 'Daily Sales Summary',
  description: 'Gross sales, refunds and net sales by day, week or month',
  group: 'Sales',
  icon: 'icon-trending-up',
  columns: [
    {
      key: 'periodStart',
      header: 'Date',
      format: 'text',
      label: (row, context) => periodLabel(String(row['periodStart']), context.groupBy),
    },
    { key: 'grossSales', header: 'Gross Sales', format: 'money', align: 'end' },
    { key: 'discounts', header: 'Discounts', format: 'money', align: 'end' },
    { key: 'refundedAmount', header: 'Refunded', format: 'money', align: 'end' },
    { key: 'netSales', header: 'Net Sales', format: 'money', align: 'end' },
    { key: 'orderCount', header: 'Orders', format: 'integer', align: 'end' },
    { key: 'averageOrderValue', header: 'Avg/Order', format: 'money', align: 'end' },
    { key: 'tipsTotal', header: 'Tips', format: 'money', align: 'end' },
    { key: 'voidCancelledCount', header: 'Void/Cancelled', format: 'integer', align: 'end' },
  ],
  defaultSort: { key: 'periodStart', direction: 'desc' },
  filters: ['groupBy'],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<DailySalesReportRowDto>(all);
    const netSales = sum(rows, (row) => row.netSales);
    const orders = count(rows, (row) => row.orderCount);
    return [
      { label: 'Gross Sales', value: sum(rows, (row) => row.grossSales), format: 'money' },
      { label: 'Refunded', value: sum(rows, (row) => row.refundedAmount), format: 'money' },
      { label: 'Net Sales', value: netSales, format: 'money' },
      { label: 'Orders', value: orders, format: 'integer' },
      { label: 'Avg/Order', value: average(netSales, orders), format: 'money' },
      { label: 'Tips', value: sum(rows, (row) => row.tipsTotal), format: 'money' },
    ];
  },
  chart: {
    kind: 'area',
    title: 'Net sales',
    points: (all, context) =>
      rowsOf<DailySalesReportRowDto>(all)
        .slice()
        .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
        .map((row) => ({
          label: shortLabel(
            parseShopLocal(row.periodStart).toLocaleDateString(undefined, {
              month: context.groupBy === 'Month' ? 'short' : 'numeric',
              day: context.groupBy === 'Month' ? undefined : 'numeric',
            }),
          ),
          value: row.netSales,
        })),
  },
};

const dailyClose: ReportDefinition = {
  type: 'daily-close',
  title: 'Daily Close',
  description: 'Z-report: sales, cash vs GCash, tips, voids and staff totals for the day',
  group: 'Sales',
  icon: 'icon-receipt',
  columns: [
    { key: 'section', header: 'Section', format: 'text' },
    { key: 'label', header: 'Item', format: 'text' },
    { key: 'detail', header: 'Details', format: 'text' },
    { key: 'orderCount', header: 'Orders', format: 'integer', align: 'end' },
    { key: 'amount', header: 'Amount', format: 'money', align: 'end' },
  ],
  defaultSort: null,
  filters: [],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const sales = rowsOf<DailyCloseReportRowDto>(all).filter((row) => row.section === 'Sales');
    const amountOf = (label: string): number =>
      sales.find((row) => row.label === label)?.amount ?? 0;
    return [
      { label: 'Gross Sales', value: amountOf('Gross sales'), format: 'money' },
      { label: 'Refunds', value: amountOf('Refunds'), format: 'money' },
      { label: 'Net Sales', value: amountOf('Net sales'), format: 'money' },
      { label: 'Tips', value: amountOf('Tips'), format: 'money' },
    ];
  },
};

const payments: ReportDefinition = {
  type: 'payments',
  title: 'Payment Method Breakdown',
  description: 'Orders and amounts by payment method',
  group: 'Sales',
  icon: 'icon-coins',
  columns: [
    { key: 'paymentMethod', header: 'Payment Method', format: 'text' },
    { key: 'orderCount', header: 'Orders', format: 'integer', align: 'end' },
    STEP_GROSS,
    STEP_DISCOUNT,
    STEP_REFUNDED,
    { key: 'totalAmount', header: 'Net', format: 'money', align: 'end' },
    { key: 'totalPercent', header: 'Net %', format: 'percent', align: 'end' },
  ],
  defaultSort: { key: 'totalAmount', direction: 'desc' },
  filters: [],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<PaymentsReportRowDto>(all);
    return [
      { label: 'Total Amount', value: sum(rows, (row) => row.totalAmount), format: 'money' },
      { label: 'Orders', value: count(rows, (row) => row.orderCount), format: 'integer' },
    ];
  },
  chart: {
    kind: 'donut',
    title: 'Share of sales',
    points: (all) =>
      rowsOf<PaymentsReportRowDto>(all).map((row) => ({
        label: row.paymentMethod,
        value: row.totalAmount,
      })),
  },
};

const hourly: ReportDefinition = {
  type: 'hourly',
  title: 'Hourly Sales Distribution',
  description: 'Orders and revenue by hour of the day',
  group: 'Sales',
  icon: 'icon-history',
  columns: [
    {
      key: 'hour',
      header: 'Hour Range',
      format: 'text',
      label: (row) => hourRangeLabel(Number(row['hour'])),
    },
    { key: 'orderCount', header: 'Orders', format: 'integer', align: 'end' },
    STEP_GROSS,
    STEP_DISCOUNT,
    STEP_REFUNDED,
    { key: 'revenue', header: 'Net', format: 'money', align: 'end' },
  ],
  defaultSort: { key: 'hour', direction: 'asc' },
  filters: [],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<HourlySalesReportRowDto>(all);
    const peak = rows.reduce<HourlySalesReportRowDto | null>(
      (best, row) => (best === null || row.revenue > best.revenue ? row : best),
      null,
    );
    return [
      { label: 'Total Revenue', value: sum(rows, (row) => row.revenue), format: 'money' },
      { label: 'Orders', value: count(rows, (row) => row.orderCount), format: 'integer' },
      { label: 'Peak Hour Revenue', value: peak?.revenue ?? 0, format: 'money' },
    ];
  },
  chart: {
    kind: 'bar',
    title: 'Revenue by hour',
    points: (all) =>
      rowsOf<HourlySalesReportRowDto>(all)
        .slice()
        .sort((a, b) => a.hour - b.hour)
        .map((row) => ({ label: hourLabel(row.hour), value: row.revenue })),
  },
};

const productSales: ReportDefinition = {
  type: 'product-sales',
  title: 'Product Sales Breakdown',
  description: 'Quantity and revenue per product, bundle and add-on',
  group: 'Products',
  icon: 'icon-coffee',
  columns: [
    { key: 'productName', header: 'Product', format: 'text' },
    { key: 'categoryName', header: 'Category', format: 'text' },
    {
      key: 'subCategoryName',
      header: 'Subcategory/Type',
      format: 'text',
      label: (row) => String(row['subCategoryName'] ?? '-'),
    },
    { key: 'quantitySold', header: 'Qty', format: 'integer', align: 'end' },
    STEP_GROSS,
    STEP_DISCOUNT,
    STEP_REFUNDED,
    { key: 'revenue', header: 'Net', format: 'money', align: 'end' },
    { key: 'revenuePercent', header: 'Net %', format: 'percent', align: 'end' },
  ],
  defaultSort: { key: 'revenue', direction: 'desc' },
  filters: ['productCategory', 'splitAddOns'],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<ProductSalesReportRowDto>(all);
    return [
      { label: 'Total Revenue', value: sum(rows, (row) => row.revenue), format: 'money' },
      { label: 'Total Quantity', value: count(rows, (row) => row.quantitySold), format: 'integer' },
    ];
  },
  chart: {
    kind: 'bar',
    title: 'Top products by revenue',
    points: (all) =>
      rowsOf<ProductSalesReportRowDto>(all)
        .slice()
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, TOP_CHART_ROWS)
        .map((row) => ({ label: shortLabel(row.productName), value: row.revenue })),
  },
};

const categorySales: ReportDefinition = {
  type: 'category-sales',
  title: 'Sales by Category',
  description: 'Gross, discounts, refunds and net per category, promotions and add-ons',
  group: 'Products',
  icon: 'icon-category',
  columns: [
    { key: 'categoryName', header: 'Category', format: 'text' },
    { key: 'quantitySold', header: 'Qty', format: 'integer', align: 'end' },
    STEP_GROSS,
    STEP_DISCOUNT,
    STEP_REFUNDED,
    { key: 'revenue', header: 'Net', format: 'money', align: 'end' },
    { key: 'revenuePercent', header: 'Net %', format: 'percent', align: 'end' },
  ],
  defaultSort: { key: 'revenue', direction: 'desc' },
  filters: [],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<CategorySalesReportRowDto>(all);
    return [
      { label: 'Gross', value: sum(rows, (row) => row.grossSales), format: 'money' },
      { label: 'Discounts', value: sum(rows, (row) => row.discounts), format: 'money' },
      { label: 'Refunded', value: sum(rows, (row) => row.refundedAmount), format: 'money' },
      { label: 'Net', value: sum(rows, (row) => row.revenue), format: 'money' },
    ];
  },
  chart: {
    kind: 'bar',
    title: 'Net by category',
    points: (all) =>
      rowsOf<CategorySalesReportRowDto>(all)
        .slice()
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, TOP_CHART_ROWS)
        .map((row) => ({ label: shortLabel(row.categoryName), value: row.revenue })),
  },
};

const promotions: ReportDefinition = {
  type: 'promotions',
  title: 'Promotions Performance',
  description: 'Uses, revenue and discount given per promotion',
  group: 'Products',
  icon: 'icon-promotion',
  columns: [
    { key: 'promotionName', header: 'Promotion', format: 'text' },
    { key: 'promotionType', header: 'Type', format: 'text' },
    { key: 'uses', header: 'Uses', format: 'integer', align: 'end' },
    { key: 'revenue', header: 'Revenue', format: 'money', align: 'end' },
    {
      key: 'discountGiven',
      header: 'Discount Given',
      format: 'money',
      align: 'end',
    },
  ],
  defaultSort: { key: 'revenue', direction: 'desc' },
  filters: [],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<PromotionPerformanceReportRowDto>(all);
    return [
      { label: 'Total Uses', value: count(rows, (row) => row.uses), format: 'integer' },
      { label: 'Total Revenue', value: sum(rows, (row) => row.revenue), format: 'money' },
      {
        label: 'Discount Given',
        value: sum(rows, (row) => row.discountGiven ?? 0),
        format: 'money',
      },
    ];
  },
  chart: {
    kind: 'bar',
    title: 'Revenue by promotion',
    points: (all) =>
      rowsOf<PromotionPerformanceReportRowDto>(all)
        .slice()
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, TOP_CHART_ROWS)
        .map((row) => ({ label: shortLabel(row.promotionName), value: row.revenue })),
  },
};

const staff: ReportDefinition = {
  type: 'staff',
  title: 'Staff Performance',
  description: 'Orders, revenue and tips per staff member',
  group: 'Staff',
  icon: 'icon-user',
  columns: [
    { key: 'staffName', header: 'Staff', format: 'text' },
    { key: 'orderCount', header: 'Orders', format: 'integer', align: 'end' },
    STEP_GROSS,
    STEP_DISCOUNT,
    STEP_REFUNDED,
    { key: 'totalRevenue', header: 'Net', format: 'money', align: 'end' },
    { key: 'averageOrderValue', header: 'Avg/Order', format: 'money', align: 'end' },
    { key: 'tipsReceived', header: 'Tips', format: 'money', align: 'end' },
  ],
  defaultSort: { key: 'totalRevenue', direction: 'desc' },
  filters: ['staff'],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<StaffPerformanceReportRowDto>(all);
    const revenue = sum(rows, (row) => row.totalRevenue);
    const orders = count(rows, (row) => row.orderCount);
    return [
      { label: 'Total Revenue', value: revenue, format: 'money' },
      { label: 'Orders', value: orders, format: 'integer' },
      { label: 'Avg/Order', value: average(revenue, orders), format: 'money' },
      { label: 'Tips', value: sum(rows, (row) => row.tipsReceived), format: 'money' },
    ];
  },
  chart: {
    kind: 'bar',
    title: 'Revenue by staff',
    points: (all) =>
      rowsOf<StaffPerformanceReportRowDto>(all)
        .slice()
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, TOP_CHART_ROWS)
        .map((row) => ({ label: shortLabel(row.staffName), value: row.totalRevenue })),
  },
};

const customers: ReportDefinition = {
  type: 'customers',
  title: 'Customers',
  description: 'Top spenders, new vs returning, last visit and loyalty points',
  group: 'Customers',
  icon: 'icon-people',
  columns: [
    { key: 'customerName', header: 'Customer', format: 'text' },
    {
      key: 'isNew',
      header: 'Type',
      format: 'text',
      label: (row) => (row['isNew'] === true ? 'New' : 'Returning'),
    },
    { key: 'orderCount', header: 'Orders', format: 'integer', align: 'end' },
    { key: 'totalSpent', header: 'Spent', format: 'money', align: 'end' },
    { key: 'averageOrderValue', header: 'Avg/Order', format: 'money', align: 'end' },
    { key: 'lastVisit', header: 'Last Visit', format: 'dateTime' },
    { key: 'loyaltyPoints', header: 'Loyalty Points', format: 'integer', align: 'end' },
  ],
  defaultSort: { key: 'totalSpent', direction: 'desc' },
  filters: [],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<CustomerReportRowDto>(all);
    return [
      { label: 'Customers', value: rows.length, format: 'integer' },
      { label: 'New', value: rows.filter((row) => row.isNew).length, format: 'integer' },
      { label: 'Returning', value: rows.filter((row) => !row.isNew).length, format: 'integer' },
      { label: 'Total Spent', value: sum(rows, (row) => row.totalSpent), format: 'money' },
    ];
  },
  chart: {
    kind: 'bar',
    title: 'Top spenders',
    points: (all) =>
      rowsOf<CustomerReportRowDto>(all)
        .slice()
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .slice(0, TOP_CHART_ROWS)
        .map((row) => ({ label: shortLabel(row.customerName), value: row.totalSpent })),
  },
};

const voids: ReportDefinition = {
  type: 'voids',
  title: 'Voids and Refunds',
  description: 'Every cancelled, rejected and refunded order with its reason',
  group: 'Operations',
  icon: 'icon-delete',
  columns: [
    {
      key: 'orderNumber',
      header: 'Order',
      format: 'text',
      label: (row) => `#${String(row['orderNumber'])}`,
    },
    { key: 'orderedAt', header: 'Ordered', format: 'dateTime' },
    { key: 'voidedAt', header: 'Voided', format: 'dateTime' },
    { key: 'kind', header: 'Type', format: 'text' },
    { key: 'staffName', header: 'Staff', format: 'text' },
    {
      key: 'voidedBy',
      header: 'Voided By',
      format: 'text',
      label: (row) => String(row['voidedBy'] ?? '-'),
    },
    { key: 'amount', header: 'Amount', format: 'money', align: 'end' },
    {
      key: 'reason',
      header: 'Reason',
      format: 'text',
      label: (row) => String(row['reason'] ?? '-'),
    },
    { key: 'staffVoidRate', header: 'Staff Void Rate', format: 'percent', align: 'end' },
  ],
  defaultSort: { key: 'voidedAt', direction: 'desc' },
  filters: [],
  usesDateRange: true,
  usesSource: true,
  totals: (all) => {
    const rows = rowsOf<VoidedOrderReportRowDto>(all);
    const refunded = rows.filter((row) => row.kind === 'Refunded');
    return [
      { label: 'Voided Orders', value: rows.length, format: 'integer' },
      { label: 'Refunded Amount', value: sum(refunded, (row) => row.amount), format: 'money' },
      { label: 'Refunds', value: refunded.length, format: 'integer' },
      { label: 'Cancelled/Rejected', value: rows.length - refunded.length, format: 'integer' },
    ];
  },
};

const customerLinks: ReportDefinition = {
  type: 'customer-links',
  title: 'Customer Link Orders',
  description: 'Accepted vs rejected, rejection reasons, response times, pickup vs delivery',
  group: 'Operations',
  icon: 'icon-send',
  columns: [
    { key: 'customerName', header: 'Customer', format: 'text' },
    { key: 'orderCount', header: 'Orders', format: 'integer', align: 'end' },
    { key: 'acceptedCount', header: 'Accepted', format: 'integer', align: 'end' },
    { key: 'rejectedCount', header: 'Rejected', format: 'integer', align: 'end' },
    { key: 'awaitingCount', header: 'Awaiting', format: 'integer', align: 'end' },
    { key: 'pickupCount', header: 'Pickup', format: 'integer', align: 'end' },
    { key: 'deliveryCount', header: 'Delivery', format: 'integer', align: 'end' },
    { key: 'revenue', header: 'Revenue', format: 'money', align: 'end' },
    { key: 'averageMinutesToAccept', header: 'To Accept', format: 'minutes', align: 'end' },
    { key: 'averageMinutesToReady', header: 'To Ready', format: 'minutes', align: 'end' },
    {
      key: 'rejectionReasons',
      header: 'Rejection Reasons',
      format: 'text',
      label: (row) => String(row['rejectionReasons'] ?? '-'),
    },
  ],
  defaultSort: { key: 'orderCount', direction: 'desc' },
  filters: [],
  usesDateRange: true,
  usesSource: false,
  totals: (all) => {
    const rows = rowsOf<CustomerLinkReportRowDto>(all);
    return [
      { label: 'Orders', value: count(rows, (row) => row.orderCount), format: 'integer' },
      { label: 'Accepted', value: count(rows, (row) => row.acceptedCount), format: 'integer' },
      { label: 'Rejected', value: count(rows, (row) => row.rejectedCount), format: 'integer' },
      { label: 'Revenue', value: sum(rows, (row) => row.revenue), format: 'money' },
    ];
  },
};

const stockStatus: ReportDefinition = {
  type: 'stock-status',
  title: 'Stock Status',
  description: 'Items at warning, critical or out of stock, and the value of stock on hand',
  group: 'Inventory',
  icon: 'icon-inventory',
  columns: [
    { key: 'itemName', header: 'Item', format: 'text' },
    { key: 'status', header: 'Status', format: 'text' },
    {
      key: 'currentQuantity',
      header: 'On Hand',
      format: 'decimal',
      align: 'end',
      label: (row) => `${formatDecimal(Number(row['currentQuantity']))} ${String(row['unitName'])}`,
    },
    { key: 'warningQuantity', header: 'Warning At', format: 'decimal', align: 'end' },
    { key: 'criticalQuantity', header: 'Critical At', format: 'decimal', align: 'end' },
    { key: 'costPrice', header: 'Unit Cost', format: 'money', align: 'end' },
    { key: 'stockValue', header: 'Stock Value', format: 'money', align: 'end' },
  ],
  defaultSort: null,
  filters: [],
  usesDateRange: false,
  usesSource: false,
  totals: (all) => {
    const rows = rowsOf<StockStatusReportRowDto>(all);
    return [
      { label: 'Items', value: rows.length, format: 'integer' },
      {
        label: 'Out of Stock',
        value: rows.filter((row) => row.status === 'Out of stock').length,
        format: 'integer',
      },
      {
        label: 'Critical/Warning',
        value: rows.filter((row) => row.status === 'Critical' || row.status === 'Warning').length,
        format: 'integer',
      },
      { label: 'Stock Value', value: sum(rows, (row) => row.stockValue), format: 'money' },
    ];
  },
};

export function formatDecimal(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SUM_KEYS = new Set([
  'grossSales',
  'discounts',
  'refundedAmount',
  'netSales',
  'orderCount',
  'tipsTotal',
  'voidCancelledCount',
  'quantitySold',
  'revenue',
  'revenuePercent',
  'totalAmount',
  'totalPercent',
  'totalRevenue',
  'tipsReceived',
  'uses',
  'discountGiven',
  'totalSpent',
  'loyaltyPoints',
  'amount',
  'acceptedCount',
  'rejectedCount',
  'awaitingCount',
  'pickupCount',
  'deliveryCount',
  'stockValue',
]);

// Columns that can be left out on narrower screens because the cards and exports still show them.
const LOW_PRIORITY_KEYS = new Set([
  'subCategoryName',
  'voidCancelledCount',
  'staffVoidRate',
  'voidedBy',
  'loyaltyPoints',
  'rejectionReasons',
  'pickupCount',
  'deliveryCount',
  'awaitingCount',
  'averageMinutesToReady',
  'criticalQuantity',
  'costPrice',
  'tipsTotal',
  'orderedAt',
]);

// An average over the rows is the total of its amount over the total of its count, never the average of averages.
const AVERAGE_TOTALS: Partial<Record<ReportType, Record<string, [string, string]>>> = {
  'daily-sales': { averageOrderValue: ['netSales', 'orderCount'] },
  staff: { averageOrderValue: ['totalRevenue', 'orderCount'] },
  customers: { averageOrderValue: ['totalSpent', 'orderCount'] },
};

const NO_TOTAL_ROW: ReadonlySet<ReportType> = new Set<ReportType>(['daily-close']);

function withTotals(definition: ReportDefinition): ReportDefinition {
  const averages = AVERAGE_TOTALS[definition.type] ?? {};
  return {
    ...definition,
    columns: definition.columns.map((column) => {
      const pair = averages[column.key];
      const total = NO_TOTAL_ROW.has(definition.type)
        ? undefined
        : pair
          ? (rows: readonly ReportRow[]): number =>
              average(columnSum(rows, pair[0]), columnSum(rows, pair[1]))
          : SUM_KEYS.has(column.key)
            ? (rows: readonly ReportRow[]): number => columnSum(rows, column.key)
            : undefined;
      return { ...column, total, lowPriority: LOW_PRIORITY_KEYS.has(column.key) };
    }),
  };
}

function columnSum(rows: readonly ReportRow[], key: string): number {
  return sumAmounts(rows.map((row) => Number(row[key] ?? 0)));
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  dailyClose,
  dailySales,
  categorySales,
  payments,
  hourly,
  productSales,
  promotions,
  staff,
  customers,
  voids,
  customerLinks,
  stockStatus,
].map(withTotals);

export function findReportDefinition(type: ReportType): ReportDefinition {
  return REPORT_DEFINITIONS.find((definition) => definition.type === type) ?? REPORT_DEFINITIONS[1];
}
