import {
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';

/**
 * Animated number counter that rolls to the target value with an easing curve.
 * Highlights briefly on change with a configurable accent color.
 *
 * Usage:
 * ```html
 * <app-animated-counter [value]="totalRevenue()" [prefix]="'₱'" [decimals]="2" />
 * ```
 */
@Component({
  selector: 'app-animated-counter',
  imports: [CommonModule, DecimalPipe],
  template: `
    <span
      #counterEl
      class="inline-block transition-colors duration-700"
      [class.scale-105]="isHighlighting()"
      [style.color]="isHighlighting() ? highlightColor() : ''"
    >
      @if (prefix()) {
        <span class="text-base font-semibold" [style.color]="prefixColor()">{{ prefix() }}</span>
      }{{ displayValue() | number: '1.' + decimals() + '-' + decimals() }}
    </span>
  `,
  styles: `
    :host {
      display: inline;
    }
  `,
})
export class AnimatedCounterComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly counterEl = viewChild<ElementRef<HTMLSpanElement>>('counterEl');

  /** The target value to animate towards. */
  public readonly value = input.required<number>();

  /** String to prepend (e.g. ₱, $). */
  public readonly prefix = input<string>('');

  /** Color for the prefix character. */
  public readonly prefixColor = input<string>('');

  /** Number of decimal places. */
  public readonly decimals = input<number>(0);

  /** Duration of the count animation in milliseconds. */
  public readonly duration = input<number>(600);

  /** Flash color on change. */
  public readonly highlightColor = input<string>('#047857');

  protected readonly displayValue = signal(0);
  protected readonly isHighlighting = signal(false);

  private currentValue = 0;
  private animationFrameId: number | null = null;
  private highlightTimeout: ReturnType<typeof setTimeout> | null = null;
  private isFirstRender = true;

  constructor() {
    effect(() => {
      const target = this.value();
      this.animateTo(target);
    });

    this.destroyRef.onDestroy(() => {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
      }

      if (this.highlightTimeout !== null) {
        clearTimeout(this.highlightTimeout);
      }
    });
  }

  private animateTo(target: number): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // First render: snap immediately, no animation
    if (this.isFirstRender) {
      this.isFirstRender = false;
      this.currentValue = target;
      this.displayValue.set(target);
      return;
    }

    const startValue = this.currentValue;
    const diff = target - startValue;

    if (diff === 0) {
      return;
    }

    // Trigger highlight flash
    this.isHighlighting.set(true);

    if (this.highlightTimeout !== null) {
      clearTimeout(this.highlightTimeout);
    }

    this.highlightTimeout = setTimeout(() => {
      this.isHighlighting.set(false);
    }, 900);

    const dur = this.duration();
    const startTime = performance.now();

    const step = (now: number): void => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / dur, 1);

      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = startValue + diff * eased;
      this.displayValue.set(current);

      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(step);
      } else {
        this.currentValue = target;
        this.displayValue.set(target);
        this.animationFrameId = null;
      }
    };

    this.animationFrameId = requestAnimationFrame(step);
  }
}
