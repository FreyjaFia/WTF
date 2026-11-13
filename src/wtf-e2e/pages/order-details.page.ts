import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class OrderDetailsPage {
  public readonly refundButton: Locator;
  public readonly stockMovements: Locator;
  public readonly refundNote: Locator;
  public readonly refundNoteError: Locator;
  public readonly refundDialog: Locator;
  public readonly heldBox: Locator;
  public readonly stockAfterRejecting: Locator;
  public readonly rejectDialog: Locator;
  public readonly notes: Locator;

  public constructor(private readonly page: Page) {
    this.refundButton = page.getByRole('button', { name: 'Refund Order', exact: true });
    this.stockMovements = page.getByTestId('stock-movements');
    this.refundDialog = page.getByRole('dialog');
    this.heldBox = page.locator('[data-held-order]');
    this.stockAfterRejecting = page.locator('#stock-after-rejecting');
    this.rejectDialog = page.locator('app-reject-order-dialog');
    this.notes = page.locator('[data-review-notes]');
    this.refundNote = page.locator('#refund-note');
    this.refundNoteError = this.refundDialog.getByText('Refund note is required.');
  }

  public async open(orderId: string): Promise<void> {
    await go(this.page, ROUTES.orderDetails(orderId));
    await this.page.getByText('Order total').or(this.page.getByText('Refunded', { exact: true })).first().waitFor();
  }

  public async openHeld(orderId: string): Promise<void> {
    await go(this.page, ROUTES.orderDetails(orderId));
    await this.heldBox.waitFor();
  }

  public async rejectHeld(reason: string, stockOutcome: 'none' | 'waste'): Promise<void> {
    await this.stockAfterRejecting.selectOption(stockOutcome);
    await this.heldBox.getByRole('button', { name: 'Reject', exact: true }).click();
    await this.rejectDialog.locator('#reject-order-reason').fill(reason);
    await this.rejectDialog.getByRole('button', { name: 'Reject Order', exact: true }).click();
  }

  public stockChoice(productName: string): Locator {
    return this.page.getByLabel(`Stock for ${productName}`);
  }

  public async startRefund(): Promise<void> {
    await this.refundButton.click();
    await this.refundDialog.getByRole('heading', { name: 'Refund Order?' }).waitFor();
  }

  public async confirmRefund(): Promise<void> {
    await this.refundDialog.getByRole('button', { name: 'Refund Order', exact: true }).click();
  }
}
