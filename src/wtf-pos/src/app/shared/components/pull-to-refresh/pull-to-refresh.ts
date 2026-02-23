import {
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';


const PULL_THRESHOLD = 80;
const MAX_PULL = 120;

@Component({
  selector: 'app-pull-to-refresh',
  imports: [],
  templateUrl: './pull-to-refresh.html',
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class PullToRefreshComponent {
  public readonly refreshing = input<boolean>(false);
  public readonly refreshTriggered = output<void>();

  protected readonly scrollContainer = viewChild.required<ElementRef<HTMLElement>>('scrollContainer');

  protected readonly pullDistance = signal(0);
  private isPulling = false;
  private touchStartY = 0;

  protected readonly indicatorHeight = computed(() => {
    if (this.refreshing()) {
      return 48;
    }
    return this.pullDistance();
  });

  protected readonly isPastThreshold = computed(() => this.pullDistance() >= PULL_THRESHOLD);

  protected readonly pullRotation = computed(() => {
    const ratio = Math.min(this.pullDistance() / PULL_THRESHOLD, 1);
    return ratio * 180;
  });

  protected onTouchStart(event: TouchEvent): void {
    const el = this.scrollContainer().nativeElement;

    // Only start pull-to-refresh when scrolled to top
    if (el.scrollTop <= 0 && !this.refreshing()) {
      this.touchStartY = event.touches[0].clientY;
      this.isPulling = true;
    }
  }

  protected onTouchMove(event: TouchEvent): void {
    if (!this.isPulling || this.refreshing()) {
      return;
    }

    const currentY = event.touches[0].clientY;
    const delta = currentY - this.touchStartY;

    if (delta > 0) {
      // Apply resistance: the further you pull, the harder it gets
      const resisted = Math.min(delta * 0.5, MAX_PULL);
      this.pullDistance.set(resisted);

      // Prevent native scroll while pulling the indicator
      if (this.scrollContainer().nativeElement.scrollTop <= 0) {
        event.preventDefault();
      }
    } else {
      // User scrolled up — cancel pull
      this.pullDistance.set(0);
      this.isPulling = false;
    }
  }

  protected onTouchEnd(): void {
    if (!this.isPulling) {
      return;
    }

    if (this.isPastThreshold() && !this.refreshing()) {
      this.refreshTriggered.emit();
    }

    this.pullDistance.set(0);
    this.isPulling = false;
  }
}
