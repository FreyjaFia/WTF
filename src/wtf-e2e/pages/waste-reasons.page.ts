import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class WasteReasonsPage {
  public readonly heading: Locator;
  public readonly list: Locator;
  public readonly add: Locator;
  public readonly name: Locator;
  public readonly sortOrder: Locator;
  public readonly requiresNote: Locator;
  public readonly formError: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Waste Reasons' });
    this.list = page.getByTestId('waste-reason-list');
    this.add = page.getByTestId('add-waste-reason');
    this.name = page.locator('#waste-reason-name');
    this.sortOrder = page.locator('#waste-reason-order');
    this.requiresNote = page.getByRole('dialog').getByRole('checkbox');
    this.formError = page.getByRole('dialog').getByRole('alert');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.wasteReasons);
    await this.heading.waitFor();
  }

  public row(name: string): Locator {
    return this.list.locator('li').filter({ hasText: name });
  }

  public async addReason(name: string, requiresNote: boolean = false): Promise<void> {
    await this.add.click();
    await this.name.fill(name);
    if (requiresNote) {
      await this.requiresNote.check();
    }

    await this.page.getByRole('dialog').getByRole('button', { name: 'Add Reason' }).click();
  }

  public async confirmDialog(label: string): Promise<void> {
    await this.page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  }
}
