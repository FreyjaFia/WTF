import { Locator, Page } from '@playwright/test';

export class RecordWasteDialog {
  public readonly root: Locator;
  public readonly quantity: Locator;
  public readonly reason: Locator;
  public readonly notes: Locator;
  public readonly balanceHint: Locator;
  public readonly blockedNotice: Locator;
  public readonly belowZeroNotice: Locator;
  public readonly reviewNotice: Locator;
  public readonly error: Locator;
  public readonly confirm: Locator;

  public constructor(page: Page) {
    this.root = page.locator('app-record-waste-dialog');
    this.quantity = this.root.locator('#waste-quantity');
    this.reason = this.root.locator('#waste-reason');
    this.notes = this.root.locator('#waste-notes');
    this.balanceHint = this.root.getByTestId('waste-balance');
    this.blockedNotice = this.root.getByTestId('waste-blocked');
    this.belowZeroNotice = this.root.getByTestId('waste-below-zero');
    this.reviewNotice = this.root.getByTestId('waste-needs-review');
    this.error = this.root.getByRole('alert');
    this.confirm = this.root.getByRole('button', { name: 'Record Waste' });
  }

  public async fill(quantity: number, reasonName: string, notes?: string): Promise<void> {
    await this.quantity.fill(String(quantity));
    await this.reason.selectOption({ label: reasonName });
    if (notes !== undefined) {
      await this.notes.fill(notes);
    }
  }

  public async submit(): Promise<void> {
    await this.confirm.click();
  }
}
