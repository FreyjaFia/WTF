import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class OrderEditorPage {
  public readonly search: Locator;
  public readonly checkoutButton: Locator;
  public readonly stockBanner: Locator;
  public readonly amountReceived: Locator;
  public readonly confirmAndPay: Locator;

  public constructor(private readonly page: Page) {
    this.search = page.getByPlaceholder('Search by product name').and(page.locator('input'));
    // The cart is drawn twice (drawer and side panel), so only the visible button counts.
    this.checkoutButton = page.getByRole('button', { name: 'Checkout', exact: true }).locator('visible=true');
    this.stockBanner = page.locator('[data-stock-banner]').locator('visible=true').first();
    this.amountReceived = page.locator('#amountReceived');
    this.confirmAndPay = page.getByRole('button', { name: 'Confirm & Pay' });
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.orderEditor);
    await this.search.waitFor();
  }

  public product(name: string): Locator {
    return this.page.locator('[role="button"].card').filter({ hasText: name }).first();
  }

  public async addProduct(name: string, times: number = 1): Promise<void> {
    await this.search.fill(name);
    for (let count = 0; count < times; count++) {
      await this.product(name).click();
      await this.page.getByRole('button', { name: 'Add to Cart', exact: true }).click();
    }
  }

  public async payCash(amount: number): Promise<void> {
    await this.checkoutButton.click();
    await this.amountReceived.fill(String(amount));
    await this.confirmAndPay.click();
  }
}
