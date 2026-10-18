export type ReportGroupBy = 'Day' | 'Week' | 'Month';

/** Limits a report to orders the shop took (0) or orders customers placed through their link (1). */
export type ReportSource = 0 | 1;

export type ReportType =
  | 'daily-close'
  | 'daily-sales'
  | 'category-sales'
  | 'payments'
  | 'hourly'
  | 'product-sales'
  | 'promotions'
  | 'staff'
  | 'customers'
  | 'voids'
  | 'customer-links'
  | 'stock-status';

export type ReportSortDirection = 'asc' | 'desc';

/** Every filter a report can take; each report uses the ones it lists in its definition. */
export interface ReportQuery {
  fromDate?: string;
  toDate?: string;
  source?: ReportSource;
  groupBy?: ReportGroupBy;
  categoryId?: number;
  subCategoryId?: number;
  staffId?: string;
  splitAddOns?: boolean;
}

/** What the on-screen table shows, so the downloaded file matches it. */
export interface ReportExportOptions {
  search?: string;
  sortBy?: string;
  sortDir?: ReportSortDirection;
}

export interface DailySalesReportRowDto {
  periodStart: string;
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  tipsTotal: number;
  voidCancelledCount: number;
  refundedCount: number;
  refundedAmount: number;
  grossSales: number;
  netSales: number;
  discounts: number;
}

export interface ProductSalesReportRowDto {
  productId: string;
  productName: string;
  categoryName: string;
  subCategoryName?: string | null;
  quantitySold: number;
  revenue: number;
  revenuePercent: number;
  isAddOn: boolean;
  grossSales: number;
  discounts: number;
  refundedAmount: number;
}

export interface CategorySalesReportRowDto {
  categoryName: string;
  quantitySold: number;
  grossSales: number;
  discounts: number;
  refundedAmount: number;
  revenue: number;
  revenuePercent: number;
}

export interface PaymentsReportRowDto {
  paymentMethod: string;
  orderCount: number;
  totalAmount: number;
  totalPercent: number;
  grossSales: number;
  discounts: number;
  refundedAmount: number;
  tips: number;
}

export interface HourlySalesReportRowDto {
  hour: number;
  orderCount: number;
  revenue: number;
  grossSales: number;
  discounts: number;
  refundedAmount: number;
}

export interface StaffPerformanceReportRowDto {
  staffId: string;
  staffName: string;
  orderCount: number;
  totalRevenue: number;
  averageOrderValue: number;
  tipsReceived: number;
  grossSales: number;
  discounts: number;
  refundedAmount: number;
}

export interface DailyCloseReportRowDto {
  section: string;
  label: string;
  detail?: string | null;
  orderCount: number;
  amount: number;
}

export interface VoidedOrderReportRowDto {
  orderId: string;
  orderNumber: number;
  orderedAt: string;
  voidedAt?: string | null;
  kind: string;
  staffName: string;
  voidedBy?: string | null;
  amount: number;
  reason?: string | null;
  staffVoidRate: number;
}

export interface PromotionPerformanceReportRowDto {
  promotionName: string;
  promotionType: string;
  uses: number;
  revenue: number;
  discountGiven?: number | null;
}

export interface CustomerLinkReportRowDto {
  linkId?: string | null;
  customerName: string;
  orderCount: number;
  acceptedCount: number;
  rejectedCount: number;
  awaitingCount: number;
  pickupCount: number;
  deliveryCount: number;
  revenue: number;
  averageMinutesToAccept?: number | null;
  averageMinutesToReady?: number | null;
  rejectionReasons?: string | null;
}

export interface CustomerReportRowDto {
  customerId: string;
  customerName: string;
  orderCount: number;
  totalSpent: number;
  averageOrderValue: number;
  lastVisit: string;
  isNew: boolean;
  loyaltyPoints: number;
}

export interface StockStatusReportRowDto {
  itemId: string;
  itemName: string;
  unitName: string;
  currentQuantity: number;
  warningQuantity?: number | null;
  criticalQuantity?: number | null;
  status: string;
  costPrice?: number | null;
  stockValue: number;
}

export interface MonthlyReportWorkbookStatusDto {
  year: number;
  month: number;
  exists: boolean;
  fileName: string;
  generatedAtUtc?: string | null;
  sizeBytes?: number | null;
}
