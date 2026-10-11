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
  /** How many orders customers placed through this link, whatever became of them. */
  ordersCount?: number;
}

export interface OrderingLinkAccessDto {
  allowOrderingLink: boolean;
  revokedLinks: number;
}
