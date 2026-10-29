import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class StockInPage {
  public readonly heading: Locator;
  public readonly search: Locator;
  public readonly quantity: Locator;
  public readonly notes: Locator;
  public readonly summaryItem: Locator;
  public readonly balanceAfter: Locator;
  public readonly submit: Locator;
  public readonly recent: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Stock In', exact: true });
    this.search = page.getByPlaceholder('Search items').and(page.locator('input'));
    this.quantity = page.locator('#stock-in-quantity');
    this.notes = page.locator('#stock-in-notes');
    this.summaryItem = page.getByTestId('summary-item');
    this.balanceAfter = page.getByTestId('balance-after');
    this.submit = page.getByRole('button', { name: 'Add Stock', exact: true });
    this.recent = page.getByTestId('recent');
  }

  public async open(itemId?: string): Promise<void> {
    await go(this.page, itemId ? `${ROUTES.stockIn}?itemId=${itemId}` : ROUTES.stockIn);
    await this.heading.waitFor();
  }

  public tile(name: string): Locator {
    return this.page.getByTestId('item-tile').filter({ hasText: name });
  }
}
