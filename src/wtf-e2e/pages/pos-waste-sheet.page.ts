import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class PosWasteSheet {
  public readonly openButton: Locator;
  public readonly sheet: Locator;
  public readonly search: Locator;

  public constructor(private readonly page: Page) {
    this.openButton = page.getByRole('button', { name: 'Record Waste' });
    this.sheet = page.locator('[aria-labelledby="pos-waste-sheet-title"]');
    this.search = this.sheet.getByLabel('Search items');
  }

  public async openOrders(): Promise<void> {
    await go(this.page, ROUTES.ordersList);
    await this.page.getByRole('heading', { name: 'Orders', exact: true }).waitFor();
  }

  public item(name: string): Locator {
    return this.sheet.getByRole('button', { name: new RegExp(name) });
  }
}
