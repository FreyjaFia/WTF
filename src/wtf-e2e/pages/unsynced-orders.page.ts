import { expect, Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class UnsyncedOrdersPage {
  public readonly heading: Locator;
  public readonly search: Locator;
  public readonly detail: Locator;
  public readonly actions: Locator;
  public readonly retry: Locator;
  public readonly saveAsNote: Locator;
  public readonly discard: Locator;
  public readonly confirm: Locator;
  public readonly reason: Locator;
  public readonly reasonError: Locator;
  public readonly filtersButton: Locator;
  public readonly filtersDrawer: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Unsynced Orders', exact: true });
    this.search = page.getByRole('searchbox').first();
    this.detail = page.locator('[data-unsynced-detail]');
    this.actions = page.locator('[data-unsynced-actions]');
    this.retry = this.actions.getByRole('button', { name: 'Fix and retry' });
    this.saveAsNote = this.actions.getByRole('button', { name: 'Save as note' });
    this.discard = this.actions.getByRole('button', { name: 'Discard' });
    this.confirm = page.locator('app-confirm-dialog');
    this.reason = page.locator('#unsynced-discard-reason');
    this.reasonError = this.confirm.getByRole('alert');
    this.filtersButton = page.locator('[data-filters-button]');
    this.filtersDrawer = page.getByRole('dialog', { name: 'Unsynced Order Filters' });
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.unsyncedOrders);
    await this.heading.waitFor();
  }

  // The list reloads a moment after typing: wait until it holds exactly the rows the search should leave.
  public async find(localId: string, expectedRows: number = 1): Promise<void> {
    await this.search.fill(localId);
    await expect(this.page.locator('[data-unsynced-row]')).toHaveCount(expectedRows);
  }

  public row(localId: string): Locator {
    return this.page.locator('[data-unsynced-row]', { hasText: localId });
  }

  public async openRow(localId: string): Promise<void> {
    await this.find(localId);
    await this.row(localId).click();
    await this.detail.waitFor();
  }

  public confirmButton(name: string): Locator {
    return this.confirm.getByRole('button', { name, exact: true });
  }
}
