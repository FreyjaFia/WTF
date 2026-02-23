export interface DashboardDto {
  today: DailySummaryDto;
  topSellingProducts: TopSellingProductDto[];
  ordersByStatus: OrdersByStatusDto;
  recentOrders: RecentOrderDto[];
  hourlyRevenue: HourlyRevenuePointDto[];
  paymentMethods: PaymentMethodBreakdownDto[];
}

export interface DailySummaryDto {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  totalTips: number;
  totalCustomers: number;
  yesterdayTotalOrders: number;
  yesterdayTotalRevenue: number;
  yesterdayAverageOrderValue: number;
  yesterdayTotalTips: number;
}

export interface TopSellingProductDto {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  imageUrl: string | null;
}

export interface OrdersByStatusDto {
  pending: number;
  completed: number;
  cancelled: number;
  refunded: number;
}

export interface RecentOrderDto {
  id: string;
  orderNumber: number;
  createdAt: string;
  totalAmount: number;
  statusId: number;
  statusName: string;
}

export interface HourlyRevenuePointDto {
  hour: number;
  revenue: number;
  orders: number;
  tips: number;
}

export interface PaymentMethodBreakdownDto {
  name: string;
  count: number;
  total: number;
}
