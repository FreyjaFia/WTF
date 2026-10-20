import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NotificationService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';
import { NotificationDto } from '@shared/models';
import {
  notificationIcon,
  reminderText,
  severityStyle,
  shortAgo,
} from '@shared/utils/notification-display';

const PANEL_SIZE = 10;

/**
 * The bell: one place for every kind of notification. A red number says how many are unread; pressing it opens the
 * latest ten, with "Mark all read" and "See all". It stays current by itself (the live connection tells the
 * notification service, which tells this panel), so a new notification shows without a refresh.
 */
@Component({
  selector: 'app-notification-bell',
  imports: [IconComponent, RouterLink],
  templateUrl: './notification-bell.html',
  host: { class: 'relative inline-block' },
})
export class NotificationBellComponent implements OnInit {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly notifications = inject(NotificationService);

  /** Where the panel hangs from the button on wide screens. */
  public readonly align = input<'start' | 'end'>('end');

  protected readonly isOpen = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly items = signal<NotificationDto[]>([]);
  protected readonly seeAllRoute = AppRoutes.Notifications;
  protected readonly unread = this.notifications.unread;
  protected readonly badge = computed(() => (this.unread() > 99 ? '99+' : String(this.unread())));
  protected readonly label = computed(() =>
    this.unread() > 0 ? `Notifications, ${this.unread()} unread` : 'Notifications',
  );
  protected readonly icon = notificationIcon;
  protected readonly style = severityStyle;
  protected readonly ago = shortAgo;
  protected readonly reminder = reminderText;

  public ngOnInit(): void {
    this.notifications.start();
    this.destroyRef.onDestroy(() => this.notifications.stop());
    // A change that arrives while the panel is open updates what it shows.
    this.notifications.changed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.isOpen()) {
        this.load();
      }
    });
  }

  protected toggle(): void {
    const next = !this.isOpen();
    this.isOpen.set(next);
    if (next) {
      this.load();
    }
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected open(item: NotificationDto): void {
    if (!item.isRead) {
      this.items.update((list) => list.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
      this.notifications.markRead({ ids: [item.id] }).subscribe({ error: () => undefined });
    }

    this.close();
    if (item.path) {
      void this.router.navigateByUrl(item.path);
    }
  }

  protected markAllRead(): void {
    this.items.update((list) => list.map((n) => ({ ...n, isRead: true })));
    this.notifications.markRead().subscribe({ error: () => undefined });
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.isOpen() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }

  private load(): void {
    this.isLoading.set(this.items().length === 0);
    this.notifications.list({ pageSize: PANEL_SIZE }).subscribe({
      next: (result) => {
        this.items.set(result.items);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }
}
