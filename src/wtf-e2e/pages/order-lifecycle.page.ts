import { Locator, Page } from '@playwright/test';

export class OrderListRows {
  public constructor(private readonly page: Page) {}

  public row(orderNumber: number): Locator {
    return this.page.getByText(`#${orderNumber}`, { exact: true }).locator('visible=true').first();
  }

  public async openOrder(orderNumber: number): Promise<void> {
    // The list shows 20 orders at a time; other tests keep adding orders, so narrow it to this one first.
    await this.page.getByPlaceholder(/search/i).and(this.page.locator('input')).first().fill(String(orderNumber));
    await this.row(orderNumber).click();
  }
}

export class OrderDetailsButtons {
  public readonly override: Locator;
  public readonly refund: Locator;

  public constructor(page: Page) {
    this.override = page.getByRole('button', { name: 'Override Order', exact: true });
    this.refund = page.getByRole('button', { name: 'Refund Order', exact: true });
  }
}
