import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class OrderListPage {
  public constructor(private readonly page: Page) {}

  public async open(): Promise<void> {
    await go(this.page, ROUTES.ordersList);
    await this.page.getByRole('heading', { name: 'Orders', exact: true }).waitFor();
  }

  public async openAwaiting(): Promise<void> {
    await go(this.page, ROUTES.awaitingOrders);
    await this.page.getByRole('heading', { name: 'Awaiting approval', exact: true }).waitFor();
  }

  public awaiting(orderNumber: number): Locator {
    return this.page
      .getByTestId('awaiting-row')
      .filter({ has: this.page.getByRole('button', { name: `Open order ${orderNumber}` }) });
  }

  public async accept(orderNumber: number): Promise<void> {
    await this.awaiting(orderNumber).getByRole('button', { name: 'Accept', exact: true }).click();
  }

  public async reject(orderNumber: number, reason: string): Promise<void> {
    await this.awaiting(orderNumber).getByRole('button', { name: 'Reject', exact: true }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('#reject-order-reason').fill(reason);
    await dialog.getByRole('button', { name: 'Reject Order' }).click();
  }
}
