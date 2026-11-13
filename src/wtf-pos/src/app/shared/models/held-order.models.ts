export interface HeldOrderRowDto {
  id: string;
  orderNumber: number;
  createdAt: string;
  cashierId: string;
  cashierName: string;
  customerName?: string | null;
  amount: number;
  itemsText: string;
  reasonCodes: string[];
  reasons: string[];
  isAged: boolean;
  ageDays: number;
  seniorPwdDiscount: number;
}

export interface HeldOrdersDto {
  items: HeldOrderRowDto[];
  totalCount: number;
  totalAmount: number;
  agedCount: number;
  agedAmount: number;
  agedAfterDays: number;
}

export interface HeldOrderFilter {
  reasonCodes?: string[];
  cashierId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  agedOnly?: boolean;
  ids?: string[];
}

export type BulkApproveOutcome =
  | 'WouldApprove'
  | 'Approved'
  | 'SkippedSeniorPwd'
  | 'SkippedNotHeld'
  | 'Failed';

export interface BulkApproveItemDto {
  id: string;
  orderNumber?: number | null;
  amount: number;
  outcome: BulkApproveOutcome;
  message?: string | null;
}

export interface BulkApproveResultDto {
  preview: boolean;
  count: number;
  totalAmount: number;
  skippedCount: number;
  failedCount: number;
  truncated: boolean;
  items: BulkApproveItemDto[];
}

export const HELD_REASON_LABELS: Record<string, string> = {
  PriceChanged: 'Price changed',
  AddOnPriceChanged: 'Add-on price changed',
  ProductInactive: 'Product unavailable',
  PromotionEnded: 'Promotion ended',
  PromotionOverLimit: 'Promotion over its limit',
  BundleChanged: 'Bundle changed',
  CustomerInactive: 'Customer inactive',
  UnknownProduct: 'Unknown product',
  SeniorPwdSettingsChanged: 'Senior/PWD settings changed',
  SeniorPwdDisabled: 'Senior/PWD switched off',
  SeniorPwdIdMissing: 'Senior/PWD ID missing',
  SeniorPwdOnPromotion: 'Senior/PWD on a promotion',
};

export function heldReasonLabel(code: string): string {
  return HELD_REASON_LABELS[code] ?? code;
}

export function isSeniorPwdReason(code: string): boolean {
  return code.startsWith('SeniorPwd');
}
