export type ReportGroupBy = 'Day' | 'Week' | 'Month';

export type ReportType = 'daily-sales' | 'product-sales' | 'payments' | 'hourly' | 'staff';

export interface DailySalesReportQuery {
  fromDate: string;
  toDate: string;
  groupBy?: ReportGroupBy;
}

export interface ProductSalesReportQuery {
  fromDate: string;
  toDate: string;
  categoryId?: number;
  subCategoryId?: number;
}

export interface PaymentsReportQuery {
  fromDate: string;
  toDate: string;
}

export interface HourlySalesReportQuery {
  fromDate: string;
  toDate: string;
}

export interface StaffPerformanceReportQuery {
  fromDate: string;
  toDate: string;
  staffId?: string;
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
