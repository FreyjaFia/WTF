import { AfterViewInit, Component, ElementRef, inject, input, OnDestroy, output, viewChild } from '@angular/core';
import { ModalStackService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';

/**
 * One picture shown large over everything, like a photo viewer: dark backdrop, the picture centered on the screen. A tap
 * on the backdrop (anywhere but the picture), the close button, Escape or the phone's back button closes only the
 * picture, never the chat behind it. It is a native modal dialog, which the browser draws above the whole page, so the
 * chat panel's sliding transform cannot pull it off-center.
 */
@Component({
  selector: 'app-chat-lightbox',
  imports: [IconComponent],
  templateUrl: './chat-lightbox.html',
})
export class ChatLightboxComponent implements AfterViewInit, OnDestroy {
  private readonly modalStack = inject(ModalStackService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private modalStackId: number | null = null;

  public readonly src = input.required<string>();
  public readonly closed = output<void>();

  public ngAfterViewInit(): void {
    const element = this.dialog().nativeElement;
    if (typeof element.showModal === 'function') {
      element.showModal();
    } else {
      element.setAttribute('open', '');
    }

    // The phone's back button closes the picture first, then the chat.
    this.modalStackId = this.modalStack.push(() => this.close());
  }

  public ngOnDestroy(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  /** The dialog fills the screen, so a click that lands on the dialog itself is a click on the backdrop. */
  protected onClick(event: MouseEvent): void {
    event.stopPropagation();
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }

  /** Escape: close the picture and keep the browser from also closing it a second way. */
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  protected close(): void {
    this.closed.emit();
  }
}
