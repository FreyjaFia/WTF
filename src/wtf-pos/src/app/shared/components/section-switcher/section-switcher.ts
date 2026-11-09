import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { HubGroup } from '@shared/navigation/hub-groups';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-section-switcher',
  imports: [RouterLink],
  templateUrl: './section-switcher.html',
  host: {
    class: 'relative block',
    '(document:keydown.escape)': 'close()',
  },
})
export class SectionSwitcherComponent {
  private readonly router = inject(Router);

  public readonly groups = input.required<HubGroup[]>();
  public readonly hubLabel = input.required<string>();
  public readonly hubRoute = input.required<string>();
  public readonly testIdPrefix = input.required<string>();

  protected readonly isOpen = signal(false);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly cardCount = computed(() =>
    this.groups().reduce((total, group) => total + group.cards.length, 0),
  );

  protected readonly currentRoute = computed(() => {
    const path = this.currentUrl().split(/[?#]/)[0];
    const routes = this.groups().flatMap((group) => group.cards.map((card) => card.route));
    return routes.find((route) => path === route || path.startsWith(route + '/')) ?? null;
  });

  protected toggle(): void {
    this.isOpen.update((open) => !open);
  }

  protected close(): void {
    this.isOpen.set(false);
  }
}
