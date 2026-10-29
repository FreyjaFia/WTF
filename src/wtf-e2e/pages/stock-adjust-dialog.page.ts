import { Locator, Page } from '@playwright/test';

export class StockAdjustDialog {
  public readonly root: Locator;
  public readonly quantity: Locator;
  public readonly reason: Locator;
  public readonly notes: Locator;
  public readonly difference: Locator;
  public readonly save: Locator;
  public readonly opener: Locator;

  public constructor(private readonly page: Page) {
    this.opener = page.getByRole('button', { name: 'Adjust Stock', exact: true });
    this.root = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Adjust Stock' }) });
    this.quantity = this.root.locator('#adjust-quantity');
    this.reason = this.root.locator('#adjust-reason');
    this.notes = this.root.locator('#adjust-notes');
    this.difference = this.root.getByTestId('difference');
    this.save = this.root.getByRole('button', { name: 'Save Adjustment' });
  }

  public async chooseMode(label: 'I counted' | 'Plus / minus'): Promise<void> {
    await this.root.getByLabel(label).check();
  }
}
