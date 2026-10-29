import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class OrderListPage {
  public readonly awaitingToggle: Locator;

  public constructor(private readonly page: Page) {
    this.awaitingToggle = page.getByRole('button', { name: /Awaiting approval/ });
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.ordersList);
    await this.page.getByRole('heading', { name: 'Orders', exact: true }).waitFor();
  }

  public async expandAwaiting(): Promise<void> {
    await this.awaitingToggle.waitFor();
    if ((await this.awaitingToggle.getAttribute('aria-expanded')) !== 'true') {
      await this.awaitingToggle.click();
    }
  }

  public awaiting(orderNumber: number): Locator {
    return this.page
      .getByRole('button', { name: `Open order ${orderNumber}` })
      .locator('xpath=ancestor::div[contains(@class,"shadow-sm")][1]');
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
