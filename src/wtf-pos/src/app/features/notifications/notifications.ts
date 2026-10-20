import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AlertService, NotificationService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { NOTIFICATION_KIND_LABELS, NotificationDto } from '@shared/models';
import {
  notificationIcon,
  reminderText,
  severityStyle,
  shortAgo,
} from '@shared/utils/notification-display';

const PAGE_SIZE = 25;

interface KindFilter {
  kind: string | null;
  label: string;
}

@Component({
  selector: 'app-notifications',
  imports: [IconComponent],
  templateUrl: './notifications.html',
  host: { class: 'flex-1 min-h-0' },
})
export class NotificationsComponent implements OnInit {
  private readonly service = inject(NotificationService);
  private readonly alertService = inject(AlertService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<NotificationDto[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly isLoading = signal(false);
  protected readonly isMarking = signal(false);
  protected readonly kind = signal<string | null>(null);
  protected readonly unreadOnly = signal(false);
  protected readonly unread = this.service.unread;
  protected readonly canLoadMore = computed(() => this.items().length < this.totalCount());
  protected readonly kindFilters = computed<KindFilter[]>(() => {
    const kinds = new Set<string>([
      ...Object.keys(NOTIFICATION_KIND_LABELS),
      ...Object.keys(this.service.unreadByKind()),
    ]);
    return [
      { kind: null, label: 'All' },
      ...[...kinds].map((kind) => ({ kind, label: NOTIFICATION_KIND_LABELS[kind] ?? kind })),
    ];
  });
  protected readonly icon = notificationIcon;
  protected readonly style = severityStyle;
  protected readonly ago = shortAgo;
  protected readonly reminder = reminderText;

  public ngOnInit(): void {
    this.service.start();
    this.destroyRef.onDestroy(() => this.service.stop());
    // The page stays current: a new notification, or one read on another device, reloads the list.
    this.service.changed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load(true));
    this.load(true);
  }

  protected unreadOf(kind: string | null): number {
    return kind === null ? this.unread() : (this.service.unreadByKind()[kind] ?? 0);
  }

  protected selectKind(kind: string | null): void {
    this.kind.set(kind);
    this.load(true);
  }

  protected toggleUnreadOnly(): void {
    this.unreadOnly.update((value) => !value);
    this.load(true);
  }

  protected load(reset: boolean): void {
    const page = reset ? 1 : Math.floor(this.items().length / PAGE_SIZE) + 1;
    this.isLoading.set(reset ? this.items().length === 0 : true);
    this.service
      .list({ kind: this.kind(), unreadOnly: this.unreadOnly(), page, pageSize: PAGE_SIZE })
      .subscribe({
        next: (result) => {
          this.items.set(reset ? result.items : [...this.items(), ...result.items]);
          this.totalCount.set(result.totalCount);
          this.isLoading.set(false);
        },
        error: (err) => {
          this.alertService.error(err.message);
          this.isLoading.set(false);
        },
      });
  }

  protected markAllRead(): void {
    if (this.isMarking() || this.unread() === 0) {
      return;
    }

    this.isMarking.set(true);
    this.service.markRead({ kind: this.kind() ?? undefined }).subscribe({
      next: () => {
        this.items.update((list) => list.map((n) => ({ ...n, isRead: true })));
        this.isMarking.set(false);
        if (this.unreadOnly()) {
          this.load(true);
        }
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isMarking.set(false);
      },
    });
  }

  protected open(item: NotificationDto): void {
    if (!item.isRead) {
      this.items.update((list) => list.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
      this.service.markRead({ ids: [item.id] }).subscribe({ error: () => undefined });
    }

    if (item.path) {
      void this.router.navigateByUrl(item.path);
    }
  }
}
