import { NOTIFICATION_KIND_LABELS, NotificationDto, NotificationKinds } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { notificationIcon, reminderText, severityStyle, shortAgo } from './notification-display';

describe('notification display helpers', () => {
  it('picks an icon by kind, with the bell as the fallback for kinds that have none yet', () => {
    expect(notificationIcon('StockAlert')).toBe('icon-stock-alert');
    expect(notificationIcon('WasteReview')).toBe('icon-delete');
    expect(notificationIcon('SomethingNew')).toBe('icon-notifications');
  });

  it('labels the waste review kind for the notification filter', () => {
    expect(NotificationKinds.WasteReview).toBe('WasteReview');
    expect(NOTIFICATION_KIND_LABELS[NotificationKinds.WasteReview]).toBe('Waste');
  });

  it('gives each severity its own colours, and treats an unknown one as info', () => {
    expect(severityStyle('Critical').icon).toContain('red');
    expect(severityStyle('Warning').icon).toContain('amber');
    expect(severityStyle('Info').icon).toContain('sky');
    expect(severityStyle('Mystery' as never)).toEqual(severityStyle('Info'));
  });

  it('writes how long ago in a short form', () => {
    const now = new Date('2026-10-21T12:00:00Z').getTime();
    const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

    expect(shortAgo(ago(0), now)).toBe('now');
    expect(shortAgo(ago(5), now)).toBe('5m');
    expect(shortAgo(ago(180), now)).toBe('3h');
    expect(shortAgo(ago(60 * 24 * 2), now)).toBe('2d');
    expect(shortAgo(ago(60 * 24 * 30), now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('says which reminder a row is, and nothing for a first alert', () => {
    expect(reminderText({ reminderCount: 0 } as NotificationDto)).toBe('');
    expect(reminderText({ reminderCount: 2 } as NotificationDto)).toBe('Reminder 2');
  });
});
