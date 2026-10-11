import { Component, computed, input, OnDestroy, output, signal } from '@angular/core';

/** How long the button has to be held, matching the hold-to-pay button of the order screen. */
export const DEFAULT_HOLD_MS = 1000;
const TICK_MS = 30;
/** How long the "keep holding" reminder stays after the button was let go too early. */
const REMINDER_MS = 2000;

/**
 * A button that only acts when it is pressed and held, so an order is not sent by an accidental tap. A fill grows
 * across the button while it is held; letting go early cancels. It works with a finger, a mouse and the keyboard
 * (hold Enter or Space).
 */
@Component({
  selector: 'app-hold-button',
  templateUrl: './hold-button.html',
  host: { class: 'contents' },
})
export class HoldButtonComponent implements OnDestroy {
  /** The text on the button. */
  public readonly label = input.required<string>();
  public readonly busyLabel = input('Working...');
  public readonly durationMs = input(DEFAULT_HOLD_MS);
  public readonly disabled = input(false);
  /** True while the action the hold started is running. */
  public readonly busy = input(false);
  public readonly buttonClass = input('app-btn app-btn-primary app-btn-md');
  /** Shown to screen readers and as a reminder after an early release. */
  public readonly hint = input('Press and hold to confirm');
  /**
   * Whether the button shows the reminder itself after an early release. Turn it off when the page shows its own
   * (listen to <code>released</code>) so the two never overlap.
   */
  public readonly reminder = input(true);

  /** Emitted once, when the button has been held long enough. */
  public readonly held = output<void>();
  /** Emitted when the button is let go before the time is up. */
  public readonly released = output<void>();

  protected readonly progress = signal(0);
  protected readonly isHolding = signal(false);
  protected readonly showReminder = signal(false);
  protected readonly inactive = computed(() => this.disabled() || this.busy());

  private timer: ReturnType<typeof setInterval> | null = null;
  private reminderTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private pressedKey: string | null = null;

  public ngOnDestroy(): void {
    this.stopTimer();
    this.clearReminder();
  }

  protected onPointerDown(event: PointerEvent): void {
    // Only the main button or a finger; a right click should not start a hold.
    if (event.button !== 0) {
      return;
    }

    this.start();
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    // Holding a key repeats keydown; only the first one starts the hold.
    event.preventDefault();
    if (event.repeat || this.pressedKey) {
      return;
    }

    this.pressedKey = event.key;
    this.start();
  }

  protected onKeyUp(event: KeyboardEvent): void {
    if (event.key === this.pressedKey) {
      this.pressedKey = null;
      this.release();
    }
  }

  protected onRelease(): void {
    this.release();
  }

  /** A plain click does nothing: only holding works. It does remind the customer how it works. */
  protected onClick(event: Event): void {
    event.preventDefault();
  }

  protected onContextMenu(event: Event): void {
    // A long press on a phone would otherwise open the context menu in the middle of the hold.
    event.preventDefault();
  }

  private start(): void {
    if (this.inactive() || this.isHolding()) {
      return;
    }

    this.clearReminder();
    this.isHolding.set(true);
    this.progress.set(0);
    this.startedAt = Date.now();

    this.timer = setInterval(() => {
      const ratio = Math.min(1, (Date.now() - this.startedAt) / Math.max(1, this.durationMs()));
      this.progress.set(Math.round(ratio * 100));

      if (ratio >= 1) {
        this.finish();
      }
    }, TICK_MS);
  }

  private release(): void {
    if (!this.isHolding()) {
      return;
    }

    this.stopTimer();
    this.isHolding.set(false);
    this.progress.set(0);

    // Let go too early: say how it works.
    this.released.emit();
    this.showReminder.set(true);
    this.reminderTimer = setTimeout(() => this.showReminder.set(false), REMINDER_MS);
  }

  private finish(): void {
    this.stopTimer();
    this.isHolding.set(false);
    this.progress.set(0);
    this.pressedKey = null;
    this.held.emit();
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private clearReminder(): void {
    if (this.reminderTimer !== null) {
      clearTimeout(this.reminderTimer);
      this.reminderTimer = null;
    }
    this.showReminder.set(false);
  }
}
