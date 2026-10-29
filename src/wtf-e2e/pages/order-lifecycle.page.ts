import { Locator, Page } from '@playwright/test';

export class OrderListRows {
  public constructor(private readonly page: Page) {}

  public row(orderNumber: number): Locator {
    return this.page.getByText(`#${orderNumber}`, { exact: true }).locator('visible=true').first();
  }

  public async openOrder(orderNumber: number): Promise<void> {
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
