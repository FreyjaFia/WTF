import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
import { PlatformTone } from './platform-labels';

const VARIANTS: Record<PlatformTone, BadgeVariant> = {
  green: 'success',
  blue: 'info',
  amber: 'amber',
  red: 'error',
  gray: 'default',
};

@Component({
  selector: 'app-platform-chip',
  imports: [BadgeComponent],
  template: `<app-badge [variant]="variant()">{{ text() }}</app-badge>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformChipComponent {
  public readonly text = input.required<string>();
  public readonly tone = input<PlatformTone>('gray');

  protected readonly variant = computed(() => VARIANTS[this.tone()]);
}
