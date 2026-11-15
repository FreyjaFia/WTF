import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class RecordWastePage {
  public readonly heading: Locator;
  public readonly search: Locator;
  public readonly empty: Locator;
  public readonly quantity: Locator;
  public readonly reason: Locator;
  public readonly notes: Locator;
  public readonly balance: Locator;
  public readonly reviewNotice: Locator;
  public readonly error: Locator;
  public readonly submit: Locator;
  public readonly discardDialog: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Record Waste', exact: true });
    this.search = page.getByLabel('Search items');
    this.empty = page.getByTestId('record-waste-empty');
    this.quantity = page.locator('#waste-quantity');
    this.reason = page.locator('#waste-reason');
    this.notes = page.locator('#waste-notes');
    this.balance = page.getByTestId('waste-balance');
    this.reviewNotice = page.getByTestId('waste-needs-review');
    this.error = page.getByRole('alert');
    this.submit = page.getByRole('button', { name: 'Record Waste' });
    this.discardDialog = page.getByRole('heading', { name: 'Discard Changes?' });
  }

  public async openPicker(): Promise<void> {
    await go(this.page, ROUTES.wasteRecord);
    await this.heading.waitFor();
  }

  public async openItem(itemId: string): Promise<void> {
    await go(this.page, ROUTES.wasteRecordItem(itemId));
    await this.quantity.waitFor();
  }

  public item(name: string): Locator {
    return this.page.getByTestId('record-waste-item').filter({ hasText: name });
  }

  public async fill(quantity: number, reasonName: string, notes?: string): Promise<void> {
    await this.quantity.fill(String(quantity));
    await this.reason.selectOption({ label: reasonName });
    if (notes !== undefined) {
      await this.notes.fill(notes);
    }
  }
}
