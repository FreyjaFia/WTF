import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class ItemDetailsPage {
  public readonly recordWaste: Locator;
  public readonly movements: Locator;

  public constructor(private readonly page: Page) {
    this.recordWaste = page.getByTestId('record-waste-button');
    this.movements = page.getByTestId('movement-row');
  }

  public async open(itemId: string): Promise<void> {
    await go(this.page, ROUTES.itemDetails(itemId));
    await this.page.getByRole('heading').first().waitFor();
  }
}
