import { Component, input, output } from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';

export type SortDirection = 'asc' | 'desc';

/**
 * A clickable column title for the list headers: the arrow appears on the sorted column and flips
 * with the direction. Use it for any list that sorts, so every table header looks and behaves the same.
 */
@Component({
  selector: 'app-sort-header',
  imports: [IconComponent],
  template: `
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-1 text-xs font-semibold tracking-wider uppercase transition-colors"
      [class.justify-center]="align() === 'center'"
      [class.justify-end]="align() === 'end'"
      [class.text-gray-600]="!active()"
      [class.hover:text-gray-900]="!active()"
      [class.text-brand-ink]="active()"
      [attr.aria-label]="'Sort by ' + label()"
      [attr.aria-sort]="active() ? (direction() === 'asc' ? 'ascending' : 'descending') : 'none'"
      (click)="sorted.emit()"
    >
      {{ label() }}
      <span
        class="text-xs transition-opacity"
        [class.opacity-0]="!active()"
        [class.opacity-100]="active()"
      >
        <app-icon
          name="icon-arrow-up"
          [class]="
            direction() === 'desc'
              ? 'inline h-3 w-3 rotate-180 transform align-[-0.05em] transition-transform duration-200 ease-out'
              : 'inline h-3 w-3 rotate-0 transform align-[-0.05em] transition-transform duration-200 ease-out'
          "
          [fill]="'currentColor'"
        />
      </span>
    </button>
  `,
  host: { class: 'block' },
})
export class SortHeaderComponent {
  public readonly label = input.required<string>();
  public readonly active = input(false);
  public readonly direction = input<SortDirection>('asc');
  public readonly align = input<'start' | 'center' | 'end'>('start');
  public readonly sorted = output<void>();
}
