export type OrderLinkStatus = 'Active' | 'Expired' | 'Revoked';

export interface OrderLinkDto {
  id: string;
  token: string;
  status: OrderLinkStatus;
  createdAt: string;
  createdByName?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
}

export interface OrderingLinkAccessDto {
  allowOrderingLink: boolean;
  revokedLinks: number;
}
