import { Component, computed, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ConversationSummaryDto } from '@shared/models';

/**
 * The envelope with a red number, like a social network's: it shows how many conversations have something unread and
 * opens the list when pressed. Pressing a row asks the page to open that conversation. It only shows what it is given.
 */
@Component({
  selector: 'app-envelope',
  imports: [IconComponent],
  templateUrl: './envelope.html',
  host: { class: 'relative inline-block' },
})
export class EnvelopeComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  /** How many conversations are unread: the badge. */
  public readonly unread = input(0);
  public readonly items = input<ConversationSummaryDto[]>([]);
  public readonly isLoading = input(false);
  /** Which side is looking, to word the preview ("You:" for their own last message). */
  public readonly viewer = input<'staff' | 'customer'>('staff');
  /** Staff see who each conversation is with; a customer only has their own. */
  public readonly showCustomer = input(true);
  /** Where the list hangs from the button on wide screens. */
  public readonly align = input<'start' | 'end'>('end');

  public readonly opened = output<ConversationSummaryDto>();
  /** The list was opened, so the page can load it afresh. */
  public readonly listOpened = output<void>();

  protected readonly isOpen = signal(false);
  protected readonly badge = computed(() => (this.unread() > 99 ? '99+' : String(this.unread())));
  protected readonly label = computed(() =>
    this.unread() > 0 ? `Messages, ${this.unread()} unread` : 'Messages',
  );

  protected toggle(): void {
    const next = !this.isOpen();
    this.isOpen.set(next);
    if (next) {
      this.listOpened.emit();
    }
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected open(item: ConversationSummaryDto): void {
    this.close();
    this.opened.emit(item);
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

  protected preview(item: ConversationSummaryDto): string {
    if (!item.lastMessage) {
      return 'No messages yet';
    }

    if (item.lastSender === 'system') {
      return item.lastMessage;
    }

    const mine = item.lastSender === this.viewer();
    const who = mine ? 'You' : item.lastSender === 'staff' ? 'Shop' : 'Customer';
    return `${who}: ${item.lastMessage}`;
  }

  /** "now", "5m", "3h", "2d", then the date: short enough for a list row. */
  protected ago(iso: string): string {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
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
}
