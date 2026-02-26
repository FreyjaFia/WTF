export interface AuditLogDto {
  id: string;
  userId: string;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues: string | null;
  newValues: string | null;
  ipAddress: string | null;
  timestamp: string;
}

export interface AuditLogQuery {
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export interface PagedResultDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}
