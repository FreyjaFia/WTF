import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class SeniorPwdPage {
  public readonly search: Locator;
  public readonly viewCart: Locator;
  public readonly button: Locator;
  public readonly dialog: Locator;
  public readonly apply: Locator;
  public readonly removeDiscount: Locator;
  public readonly addPerson: Locator;
  public readonly cartTotal: Locator;
  public readonly section: Locator;

  public constructor(public readonly page: Page) {
    this.search = page.getByPlaceholder('Search by product name').and(page.locator('input'));
    this.viewCart = page.getByRole('button', { name: /View Cart/ });
    // The cart is drawn twice (drawer and side panel), so only the visible copy counts.
    this.button = this.visible('senior-pwd-button');
    this.section = this.visible('senior-pwd-section');
    this.cartTotal = this.visible('cart-total');
    this.dialog = page.getByTestId('senior-pwd-dialog');
    this.apply = page.getByTestId('senior-pwd-apply');
    this.removeDiscount = page.getByTestId('senior-pwd-remove');
    this.addPerson = page.getByTestId('senior-pwd-add-person');
  }

  public visible(testId: string): Locator {
    return this.page.getByTestId(testId).locator('visible=true').first();
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.orderEditor);
    await this.search.waitFor();
  }

  public async addProduct(name: string, times: number = 1): Promise<void> {
    await this.search.fill(name);
    for (let count = 0; count < times; count++) {
      await this.page.locator('[role="button"].card').filter({ hasText: name }).first().click();
      await this.page.getByRole('button', { name: 'Add to Cart', exact: true }).click();
    }
  }

  // On a phone or tablet the cart is a drawer behind the "View Cart" bar; on a desktop it is the side panel.
  public async openCart(): Promise<void> {
    if (await this.viewCart.isVisible()) {
      await this.viewCart.click();
    }
  }

  public async openDialog(): Promise<void> {
    await this.openCart();
    await this.button.click();
    await this.dialog.waitFor();
  }

  public async fillPerson(index: number, idNumber: string, name: string): Promise<void> {
    await this.page.getByTestId(`senior-pwd-id-${index}`).fill(idNumber);
    await this.page.getByTestId(`senior-pwd-name-${index}`).fill(name);
  }

  public async changeQuantity(person: number, line: number, delta: number): Promise<void> {
    const button = this.page.getByTestId(`senior-pwd-${delta > 0 ? 'inc' : 'dec'}-${person}-${line}`);
    for (let step = 0; step < Math.abs(delta); step++) {
      await button.click();
    }
  }
}
