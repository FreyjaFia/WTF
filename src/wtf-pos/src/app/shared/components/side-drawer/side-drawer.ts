import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, OnDestroy, output, signal } from '@angular/core';
import { ModalStackService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';

const DRAWER_TRANSITION_PRIME_DELAY_MS = 16;

@Component({
  selector: 'app-side-drawer',
  imports: [CommonModule, IconComponent],
  templateUrl: './side-drawer.html',
})
export class SideDrawerComponent implements OnDestroy {
  private readonly modalStack = inject(ModalStackService);

  public readonly isOpen = input(false);
  public readonly title = input.required<string>();
  public readonly subtitle = input<string>('');
  public readonly doneLabel = input('Done');
  public readonly doneAriaLabel = input('Close filters');
  public readonly leadingIconName = input<string | null>(null);
  public readonly leadingIconClass = input('h-5 w-5 text-gray-700');
  public readonly leadingIconFill = input('currentColor');
  public readonly contentClass = input('p-4');
  public readonly showFooter = input(true);

  public readonly closed = output<void>();
  protected readonly hasTransitions = signal(false);

  private modalStackId: number | null = null;
  private initTimerId: number | null = null;

  constructor() {
    // Delay enabling transitions until after first paint to avoid route-entry glitches.
    this.initTimerId = window.setTimeout(() => {
      this.hasTransitions.set(true);
      this.initTimerId = null;
    }, DRAWER_TRANSITION_PRIME_DELAY_MS);

    effect(() => {
      if (this.isOpen()) {
        this.modalStackId = this.modalStack.push(() => this.closeDrawer());
      } else if (this.modalStackId !== null) {
        this.modalStack.remove(this.modalStackId);
        this.modalStackId = null;
      }
    });
  }

  public ngOnDestroy(): void {
    if (this.initTimerId !== null) {
      window.clearTimeout(this.initTimerId);
      this.initTimerId = null;
    }

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  protected closeDrawer(): void {
    this.closed.emit();
  }
}
