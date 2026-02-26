import { Component, inject, output, signal } from '@angular/core';
import { ModalStackService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';

@Component({
  selector: 'app-exit-confirm',
  imports: [IconComponent],
  templateUrl: './exit-confirm.html',
})
export class ExitConfirmComponent {
  private readonly modalStack = inject(ModalStackService);

  public readonly confirmed = output<void>();
  public readonly cancelled = output<void>();

  protected readonly visible = signal(false);

  private modalStackId: number | null = null;

  public open(): void {
    this.visible.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancel());
  }

  public close(): void {
    this.visible.set(false);

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  protected confirm(): void {
    this.close();
    this.confirmed.emit();
  }

  protected cancel(): void {
    this.close();
    this.cancelled.emit();
  }
}
