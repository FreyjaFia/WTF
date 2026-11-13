import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class HeldOrdersPage {
  public readonly heading: Locator;
  public readonly summary: Locator;
  public readonly agedTile: Locator;
  public readonly empty: Locator;
  public readonly filtersButton: Locator;
  public readonly approveMatching: Locator;
  public readonly approveSelected: Locator;
  public readonly selectionBar: Locator;
  public readonly selectAll: Locator;
  public readonly dialog: Locator;
  public readonly dialogCount: Locator;
  public readonly dialogTotal: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Held orders', exact: true });
    this.summary = page.getByTestId('held-summary');
    this.agedTile = page.getByTestId('tile-aged');
    this.empty = page.getByTestId('held-empty');
    this.filtersButton = page.locator('[data-filters-button]').first();
    this.approveMatching = page.getByTestId('approve-matching');
    this.approveSelected = page.getByTestId('approve-selected');
    this.selectionBar = page.getByTestId('selection-bar');
    this.selectAll = page.getByTestId('select-all');
    this.dialog = page.locator('app-confirm-dialog');
    this.dialogCount = page.getByTestId('bulk-count');
    this.dialogTotal = page.getByTestId('bulk-total');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.heldOrders);
    await this.heading.waitFor();
  }

  public row(orderNumber: number): Locator {
    return this.page.getByTestId(`held-${orderNumber}`);
  }

  public select(orderNumber: number): Locator {
    return this.row(orderNumber).getByRole('checkbox', { name: `Select order ${orderNumber}` });
  }

  public async openFilters(): Promise<void> {
    await this.filtersButton.click();
    await this.page.getByText('Held Order Filters').waitFor();
  }

  public async closeFilters(): Promise<void> {
    await this.page.getByRole('button', { name: /close/i }).first().click();
  }

  public async chooseCashier(name: string): Promise<void> {
    await this.page.getByRole('radiogroup', { name: 'Cashier' }).getByText(name, { exact: true }).click();
  }

  public async confirm(count: number): Promise<void> {
    await this.dialog.getByRole('button', { name: `Approve ${count}`, exact: true }).click();
  }
}
