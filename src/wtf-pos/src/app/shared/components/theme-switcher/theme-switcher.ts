import { Component, ElementRef, computed, inject, input } from '@angular/core';
import { ThemeService } from '@core/services';
import { type ThemeId } from '@core/theme';
import { IconComponent } from '@shared/components/icons/icon/icon';

@Component({
  selector: 'app-theme-switcher',
  imports: [IconComponent],
  templateUrl: './theme-switcher.html',
})
export class ThemeSwitcherComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly themeService = inject(ThemeService);

  /** Show only the palette icon (mobile header, collapsed sidebar). */
  public readonly compact = input(false);
  /** Draw the button as a bordered pill so it stands out on pages with no toolbar (login). */
  public readonly outlined = input(false);
  /** Stretch to the width of the parent even when compact, so it lines up with neighbouring full-width rows. */
  public readonly fullWidth = input(false);
  /** Where the list opens relative to the button. */
  public readonly placement = input<'top-start' | 'top-center' | 'bottom-end' | 'bottom-start'>(
    'bottom-end',
  );

  protected readonly placementClass = computed(() => {
    switch (this.placement()) {
      case 'top-start':
        return 'dropdown-top dropdown-start';
      case 'top-center':
        return 'dropdown-top dropdown-center';
      case 'bottom-start':
        return 'dropdown-bottom dropdown-start';
      default:
        return 'dropdown-bottom dropdown-end';
    }
  });

  /** Under an app bar (header, mobile bar) the list is pinned below it on phones; elsewhere it opens beside its button. */
  protected readonly underAppBar = computed(() => this.placement().startsWith('bottom'));

  protected pick(id: ThemeId): void {
    this.themeService.set(id);
    // daisyUI keeps a dropdown open while it holds focus; release it so the list closes.
    (this.host.nativeElement.ownerDocument.activeElement as HTMLElement | null)?.blur();
  }
}
