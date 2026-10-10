import { Component, computed, input, output } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';

export type ConfirmDialogVariant = 'danger' | 'warning' | 'success';

/**
 * Where the confirm action sits:
 * - `primary`: solid button on the right, Cancel on the left (default)
 * - `secondary`: text button on the left (e.g. Discard), solid cancel button on the right (e.g. Keep Editing)
 */
export type ConfirmPlacement = 'primary' | 'secondary';

/** Tone of the text button on the left when `confirmPlacement` is `secondary`. */
export type SecondaryTone = 'danger' | 'neutral';

interface VariantStyle {
  outerRing: string;
  innerRing: string;
  icon: string;
  confirmButton: string;
}

const variantStyles: Record<ConfirmDialogVariant, VariantStyle> = {
  danger: {
    outerRing: 'mx-auto w-fit rounded-full bg-red-50/60 p-3',
    innerRing: 'rounded-full bg-red-50 p-3',
    icon: 'h-6 w-6 text-red-600',
    confirmButton: 'app-btn app-btn-danger app-btn-md px-6',
  },
  warning: {
    outerRing: 'mx-auto w-fit rounded-full bg-amber-50/60 p-3',
    innerRing: 'rounded-full bg-amber-50 p-3',
    icon: 'h-6 w-6 text-amber-600',
    confirmButton: 'app-btn app-btn-primary app-btn-md px-6',
  },
  success: {
    outerRing: 'mx-auto w-fit rounded-full bg-[#047857]/10 p-3',
    innerRing: 'rounded-full bg-[#047857]/10 p-3',
    icon: 'h-6 w-6 text-[#047857]',
    confirmButton: 'app-btn app-btn-primary app-btn-md px-6',
  },
};

const cancelButtonClass = 'app-btn app-btn-secondary app-btn-md';
const discardButtonClass = 'app-btn app-btn-outline-danger app-btn-md';
const keepButtonClass = variantStyles.success.confirmButton;

@Component({
  selector: 'app-confirm-dialog',
  imports: [IconComponent],
  templateUrl: './confirm-dialog.html',
  host: { class: 'contents' },
})
export class ConfirmDialogComponent {
  readonly variant = input<ConfirmDialogVariant>('danger');
  readonly icon = input.required<string>();
  readonly heading = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly busyLabel = input('');
  readonly cancelLabel = input('Cancel');
  readonly isBusy = input(false);
  readonly confirmPlacement = input<ConfirmPlacement>('primary');
  readonly secondaryTone = input<SecondaryTone>('danger');
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly styles = computed(() => variantStyles[this.variant()]);
  protected readonly secondaryButtonClass = computed(() =>
    this.secondaryTone() === 'neutral' ? cancelButtonClass : discardButtonClass,
  );
  protected readonly cancelButtonClass = cancelButtonClass;
  protected readonly keepButtonClass = keepButtonClass;
}
