import { Locator, Page } from '@playwright/test';
import { OrderEditorPage } from '@pages/order-editor.page';

export class PromosTabPage {
  public readonly editor: OrderEditorPage;
  public readonly tab: Locator;

  public constructor(private readonly page: Page) {
    this.editor = new OrderEditorPage(page);
    this.tab = page.locator('[data-catalog-tab="bundles"]');
  }

  public async open(): Promise<void> {
    await this.editor.open();
  }

  public async showPromos(): Promise<void> {
    await this.tab.click();
  }

  public deal(productName: string): Locator {
    return this.page.locator('[data-promo-deal]').filter({ hasText: productName });
  }
}
