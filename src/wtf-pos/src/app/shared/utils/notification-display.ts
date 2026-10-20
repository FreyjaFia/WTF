import { NotificationDto, NotificationKinds, NotificationSeverity } from '@shared/models';

/** The icon for each kind of notification, so a list can be scanned by its icons. */
export function notificationIcon(kind: string): string {
  switch (kind) {
    case NotificationKinds.StockAlert:
      return 'icon-stock-alert';
    default:
      return 'icon-notifications';
  }
}

export interface SeverityStyle {
  /** The round icon background and colour. */
  icon: string;
  /** The coloured edge on a row. */
  bar: string;
  /** The tint of an unread row. */
  unread: string;
}

const SEVERITY_STYLES: Record<NotificationSeverity, SeverityStyle> = {
  Critical: { icon: 'bg-red-100 text-red-600', bar: 'bg-red-500', unread: 'bg-red-50/70' },
  Warning: { icon: 'bg-amber-100 text-amber-600', bar: 'bg-amber-400', unread: 'bg-amber-50/70' },
  Info: { icon: 'bg-sky-100 text-sky-600', bar: 'bg-sky-400', unread: 'bg-sky-50/70' },
};

export function severityStyle(severity: NotificationSeverity): SeverityStyle {
  return SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.Info;
}

/** "now", "5m", "3h", "2d", then the date: short enough for a list row. */
export function shortAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return days < 7
    ? `${days}d`
    : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** A reminder row says how many days it has been going on, next to its time. */
export function reminderText(notification: NotificationDto): string {
  return notification.reminderCount > 0 ? `Reminder ${notification.reminderCount}` : '';
}
