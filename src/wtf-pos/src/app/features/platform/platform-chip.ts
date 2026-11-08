import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PlatformTone } from './platform-labels';

const TONES: Record<PlatformTone, string> = {
  green: 'bg-green-50 text-green-700',
  blue: 'bg-blue-50 text-blue-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  gray: 'bg-gray-100 text-gray-600',
};

@Component({
  selector: 'app-platform-chip',
  template: `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap" [class]="toneClass()">{{ text() }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformChipComponent {
  public readonly text = input.required<string>();
  public readonly tone = input<PlatformTone>('gray');

  protected readonly toneClass = computed(() => TONES[this.tone()]);
}
