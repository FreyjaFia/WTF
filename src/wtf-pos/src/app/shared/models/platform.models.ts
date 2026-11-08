export interface PlatformTenantDto {
  id: string;
  name: string;
  slug: string;
  status: number;
  statusName: string;
  createdAt: string;
  userCount: number;
  orderCount: number;
  lastOrderAt: string | null;
}

export interface PlatformTenantUserDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
}

export interface CreateTenantRequest {
  name: string;
  slug: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerUsername: string;
  isTrial: boolean;
}

export interface CreatedTenantDto {
  tenant: PlatformTenantDto;
  ownerUsername: string;
  temporaryPassword: string;
}

export interface PasswordResetDto {
  username: string;
  temporaryPassword: string;
}

export interface ImpersonationDto {
  accessToken: string;
  expiresAt: string;
  username: string;
  tenantName: string;
  readOnly: boolean;
}

export interface ImpersonationInfo {
  expiresAt: string;
  username: string;
  tenantName: string;
  readOnly: boolean;
}

export interface DeletionPreviewDto {
  tenantId: string;
  slug: string;
  status: number;
  rowCounts: Record<string, number>;
}

export interface PlatformAuditLogDto {
  id: string;
  username: string | null;
  action: string;
  tenantId: string | null;
  details: string | null;
  ipAddress: string | null;
  timestamp: string;
}

export const PLATFORM_STATUS = {
  Trial: 1,
  Active: 2,
  Suspended: 3,
  Cancelled: 4,
} as const;
