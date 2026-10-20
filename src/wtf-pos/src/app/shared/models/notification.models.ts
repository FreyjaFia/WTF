export type NotificationSeverity = 'Info' | 'Warning' | 'Critical';

export interface NotificationDto {
  id: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  path: string | null;
  subjectId: string | null;
  createdAt: string;
  isRead: boolean;
  reminderCount: number;
}

export interface NotificationCountsDto {
  unreadCount: number;
  unreadByKind: Record<string, number>;
}

export interface NotificationListDto extends NotificationCountsDto {
  items: NotificationDto[];
  totalCount: number;
}

export const NotificationKinds = {
  StockAlert: 'StockAlert',
} as const;

export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  StockAlert: 'Stock',
};
