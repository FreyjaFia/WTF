import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class AttentionTiles {
  public readonly out: Locator;
  public readonly critical: Locator;
  public readonly low: Locator;
  public readonly sidebarBadge: Locator;

  public constructor(private readonly page: Page) {
    this.out = page.getByTestId('tile-out');
    this.critical = page.getByTestId('tile-critical');
    this.low = page.getByTestId('tile-low');
    this.sidebarBadge = page.getByTestId('sidebar-alerts-badge');
  }

  public row(name: string): Locator {
    return this.page.getByTestId('attention-row').filter({ hasText: name });
  }
}

export class CoveragePage {
  public readonly heading: Locator;
  public readonly search: Locator;
  public readonly showAll: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Ingredients & Cost', exact: true });
    this.search = page.getByPlaceholder('Search products').and(page.locator('input'));
    this.showAll = page.getByTestId('filter-all');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.ingredients);
    await this.heading.waitFor();
    await this.showAll.waitFor();
  }

  public row(name: string): Locator {
    return this.page.getByTestId('coverage-row').filter({ hasText: name });
  }
}
