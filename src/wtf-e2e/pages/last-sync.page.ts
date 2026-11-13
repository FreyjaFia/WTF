import { Locator, Page } from '@playwright/test';

export class LastSyncPage {
  public readonly card: Locator;
  public readonly rows: Locator;
  public readonly clearAll: Locator;
  public readonly pendingTitle: Locator;
  public readonly newOrder: Locator;

  public constructor(private readonly page: Page) {
    this.card = page.locator('[data-last-sync]');
    this.rows = this.card.locator('[data-sync-result]');
    this.clearAll = this.card.getByRole('button', { name: 'Clear all' });
    this.newOrder = page.getByRole('button', { name: 'New Order' }).or(page.getByRole('link', { name: 'New Order' })).locator('visible=true').first();
    this.pendingTitle = page.getByText('Pending Offline Orders', { exact: true });
  }

  public row(text: string | RegExp): Locator {
    return this.rows.filter({ hasText: text });
  }

  public dismissButton(row: Locator): Locator {
    return row.getByRole('button', { name: /^Dismiss / });
  }

  public async dismiss(row: Locator): Promise<void> {
    await this.dismissButton(row).click();
  }
}
