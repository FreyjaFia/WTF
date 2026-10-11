export type ReportGroupBy = 'Day' | 'Week' | 'Month';

/** Limits a report to orders the shop took (0) or orders customers placed through their link (1). */
export type ReportSource = 0 | 1;

export type ReportType = 'daily-sales' | 'product-sales' | 'payments' | 'hourly' | 'staff';

export interface DailySalesReportQuery {
  fromDate: string;
  toDate: string;
  groupBy?: ReportGroupBy;
  source?: ReportSource;
}

export interface ProductSalesReportQuery {
  fromDate: string;
  toDate: string;
  categoryId?: number;
  subCategoryId?: number;
  source?: ReportSource;
}

export interface PaymentsReportQuery {
  fromDate: string;
  toDate: string;
  source?: ReportSource;
}

export interface HourlySalesReportQuery {
  fromDate: string;
  toDate: string;
  source?: ReportSource;
}

export interface StaffPerformanceReportQuery {
  fromDate: string;
  toDate: string;
  staffId?: string;
  source?: ReportSource;
}

export interface DailySalesReportRowDto {
  periodStart: string;
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  tipsTotal: number;
  voidCancelledCount: number;
}

export interface ProductSalesReportRowDto {
  productId: string;
  productName: string;
  categoryName: string;
  subCategoryName?: string | null;
  quantitySold: number;
  revenue: number;
  revenuePercent: number;
}

export interface PaymentsReportRowDto {
  paymentMethod: string;
  orderCount: number;
  totalAmount: number;
  totalPercent: number;
}

export interface HourlySalesReportRowDto {
  hour: number;
  orderCount: number;
  revenue: number;
}

export interface StaffPerformanceReportRowDto {
  staffId: string;
  staffName: string;
  orderCount: number;
  totalRevenue: number;
  averageOrderValue: number;
  tipsReceived: number;
}

export interface MonthlyReportWorkbookStatusDto {
  year: number;
  month: number;
  exists: boolean;
  fileName: string;
  generatedAtUtc?: string | null;
  sizeBytes?: number | null;
}
