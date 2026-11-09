import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { AppRoutes } from '@shared/constants/app-routes';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-management',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './management.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ManagementComponent {
  private readonly router = inject(Router);

  protected readonly hubRoute = AppRoutes.ManagementRoot;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  // Only the top screen of a section gets the way back: deeper pages (editors, details, a Setup list) bring their own back arrow.
  protected readonly showBackToHub = computed(() => {
    const path = this.currentUrl().split(/[?#]/)[0].split('/').filter(Boolean);
    return path.length === 2 && path[0] === 'management';
  });
}
