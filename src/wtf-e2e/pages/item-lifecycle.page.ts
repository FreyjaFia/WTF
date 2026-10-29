import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class ItemLifecyclePage {
  public readonly deleteButton: Locator;
  public readonly restoreButton: Locator;
  public readonly editButton: Locator;
  public readonly adjustButton: Locator;
  public readonly dialog: Locator;
  public readonly inactiveBadge: Locator;
  public readonly listSearch: Locator;

  public constructor(private readonly page: Page) {
    this.deleteButton = page.getByRole('button', { name: 'Delete', exact: true });
    this.restoreButton = page.getByRole('button', { name: 'Restore', exact: true });
    this.editButton = page.getByRole('link', { name: 'Edit', exact: true });
    this.adjustButton = page.getByRole('button', { name: 'Adjust Stock', exact: true });
    this.dialog = page.getByRole('dialog').filter({ has: page.locator('#confirm-dialog-title') });
    this.inactiveBadge = page.getByText('Inactive', { exact: true });
    this.listSearch = page.getByPlaceholder('Search by name, SKU, or barcode').and(page.locator('input'));
  }

  public async open(itemId: string): Promise<void> {
    await go(this.page, ROUTES.itemDetails(itemId));
    await this.page.getByRole('heading').first().waitFor();
  }

  public async openList(): Promise<void> {
    await go(this.page, ROUTES.items);
    await this.listSearch.waitFor();
  }

  public confirmIn(label: string): Locator {
    return this.dialog.getByRole('button', { name: label, exact: true });
  }
}
