import { Locator, Page } from '@playwright/test';

export class NotificationBell {
  public readonly button: Locator;
  public readonly badge: Locator;
  public readonly panel: Locator;

  public constructor(page: Page) {
    // The bell is drawn in both the sidebar and the phone header; the visible one is the one a person uses.
    this.button = page.locator('[data-bell]').locator('visible=true').first();
    this.badge = this.button.locator('[data-bell-badge]');
    this.panel = page.locator('[data-bell-panel]');
  }

  public async open(): Promise<void> {
    await this.button.click();
    await this.panel.waitFor();
  }
}
