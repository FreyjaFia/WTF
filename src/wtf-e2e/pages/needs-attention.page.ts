import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class NeedsAttentionPage {
  public readonly heading: Locator;
  public readonly allClear: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Needs Attention', exact: true });
    this.allClear = page.getByTestId('all-clear');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.attention);
    await this.heading.waitFor();
  }

  public row(itemName: string): Locator {
    return this.page.getByTestId('attention-row').filter({ hasText: itemName });
  }
}
