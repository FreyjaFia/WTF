import { AfterViewInit, Component, ElementRef, inject, input, OnDestroy, output, signal } from '@angular/core';
import { ConversationMessageDto } from '@shared/models';
import { Observable, Subscription } from 'rxjs';

/** What loads a picture: a plain address (the customer's link) or the file itself (staff, who need their login to fetch it). */
export type ChatImageLoader = (message: ConversationMessageDto) => Observable<string | Blob>;

/**
 * One picture in a chat. It reserves its space from the size the server sent, so the list does not jump, and it only
 * fetches the picture once it is on screen. Pictures are never stored on the device: a file we turned into an address
 * for showing is released when the picture goes away. Tapping it asks the chat to show it larger.
 */
@Component({
  selector: 'app-chat-image',
  templateUrl: './chat-image.html',
  host: { class: 'block' },
})
export class ChatImageComponent implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  public readonly message = input.required<ConversationMessageDto>();
  public readonly loader = input.required<ChatImageLoader>();

  /** The address to show larger. */
  public readonly opened = output<string>();

  protected readonly src = signal<string | null>(null);
  protected readonly failed = signal(false);

  private observer: IntersectionObserver | null = null;
  private subscription: Subscription | null = null;
  private objectUrl: string | null = null;
  private started = false;

  protected ratio(): string {
    const { imageWidth, imageHeight } = this.message();
    return imageWidth && imageHeight ? `${imageWidth} / ${imageHeight}` : '4 / 3';
  }

  public ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.start();
      return;
    }

    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        this.observer?.disconnect();
        this.observer = null;
        this.start();
      }
    });
    this.observer.observe(this.host.nativeElement);
  }

  public ngOnDestroy(): void {
    this.observer?.disconnect();
    this.subscription?.unsubscribe();
    this.release();
  }

  protected open(): void {
    const current = this.src();
    if (current) {
      this.opened.emit(current);
    }
  }

  protected retry(): void {
    this.started = false;
    this.failed.set(false);
    this.start();
  }

  private start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.subscription = this.loader()(this.message()).subscribe({
      next: (value) => {
        this.release();
        if (typeof value === 'string') {
          this.src.set(value);
          return;
        }

        this.objectUrl = URL.createObjectURL(value);
        this.src.set(this.objectUrl);
      },
      error: () => this.failed.set(true),
    });
  }

  private release(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
