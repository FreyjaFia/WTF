import { Component, effect, inject } from '@angular/core';
import {
  IsActiveMatchOptions,
  Router,
  RouterLink,
  RouterOutlet,
  isActive as routerIsActive,
} from '@angular/router';
import { AppRoutes } from '@shared/constants/app-routes';

interface InventoryTab {
  label: string;
  route: string;
  path: string;
  ariaLabel: string;
}

@Component({
  selector: 'app-inventory',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './inventory.html',
  host: { class: 'flex-1 min-h-0' },
})
export class InventoryComponent {
  private static readonly activeMatchOptions: IsActiveMatchOptions = {
    paths: 'subset',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  };

  private readonly router = inject(Router);
  protected readonly inventoryTabs: readonly InventoryTab[] = [
    { label: 'Items', route: 'items', path: AppRoutes.InventoryItems, ariaLabel: 'Items' },
    {
      label: 'Stock In',
      route: 'stock-in',
      path: AppRoutes.InventoryStockIn,
      ariaLabel: 'Stock In',
    },
  ];
  private readonly activeSignals = new Map<string, ReturnType<typeof routerIsActive>>();

  public constructor() {
    effect(() => {
      const activeRoute = this.getActiveInventoryRoute();
      if (activeRoute) {
        this.scrollInventoryTabIntoView(activeRoute);
      }
    });
  }

  protected isActive(route: string): boolean {
    let routeActiveSignal = this.activeSignals.get(route);
    if (!routeActiveSignal) {
      const routeTree = this.router.createUrlTree([AppRoutes.InventoryRoot, route]);
      routeActiveSignal = routerIsActive(
        routeTree,
        this.router,
        InventoryComponent.activeMatchOptions,
      );
      this.activeSignals.set(route, routeActiveSignal);
    }

    return routeActiveSignal();
  }

  protected scrollInventoryTabIntoView(route: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.setTimeout(() => {
      const tab = document.querySelector(`[data-inventory-tab="${route}"]`);
      if (!(tab instanceof HTMLElement)) {
        return;
      }

      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }

  private getActiveInventoryRoute(): string | null {
    for (const tab of this.inventoryTabs) {
      if (this.isActive(tab.route)) {
        return tab.route;
      }
    }

    return null;
  }
}
