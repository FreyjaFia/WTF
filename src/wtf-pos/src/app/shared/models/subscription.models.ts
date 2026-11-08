import type { SubscriptionWarning } from '@shared/calculations/subscription-rules';

export interface SubscriptionDto {
  managed: boolean;
  planName: string | null;
  planCode: string | null;
  features: string[];
  warning: SubscriptionWarning;
  daysLeft: number;
  periodEnd: string | null;
  accessUntil: string | null;
  graceDays: number;
  serverTime: string;
  lease: string | null;
  leaseMaxAgeDays: number;
}

export interface LeasePayload {
  v: number;
  tenantId: string;
  issuedAt: string;
  periodEnd: string;
  graceDays: number;
  accessUntil: string;
  maxAgeDays: number;
}

export interface TenantInvoiceDto {
  id: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  months: number;
  amount: number;
  status: number;
  statusName: string;
  reference: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PlanDto {
  id: number;
  code: string;
  name: string;
  monthlyPrice: number;
  features: string[];
  maxUsers: number | null;
  isActive: boolean;
}

export interface TenantSubscriptionDto {
  tenantId: string;
  tenantName: string;
  tenantStatus: number;
  planId: number;
  planName: string;
  monthlyPrice: number;
  periodStart: string;
  periodEnd: string;
  graceDays: number;
  discountPercent: number;
  notes: string | null;
  accessUntil: string;
  warning: SubscriptionWarning;
  daysLeft: number;
  invoices: TenantInvoiceDto[];
}

export interface SetSubscriptionRequest {
  planId: number;
  periodEnd: string | null;
  graceDays: number;
  discountPercent: number;
  notes: string | null;
}

export interface BrandDto {
  shopName: string;
  shortName: string | null;
  tagline: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  registrationText: string | null;
  primaryColor: string;
}

export interface PublicBrandDto {
  shopName: string;
  shortName: string | null;
  tagline: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  primaryColor: string;
}
