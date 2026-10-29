import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class WasteListPage {
  public readonly heading: Locator;
  public readonly pendingTile: Locator;
  public readonly empty: Locator;
  public readonly search: Locator;
  public readonly filtersButton: Locator;
  public readonly filtersDrawer: Locator;
  public readonly reviewNote: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Waste', exact: true });
    this.pendingTile = page.getByTestId('tile-pending');
    this.empty = page.getByTestId('waste-empty');
    this.search = page.getByLabel('Search waste');
    this.filtersButton = page.getByRole('button', { name: /filters/i }).first();
    this.filtersDrawer = page.getByRole('dialog', { name: 'Waste Filters' }).or(page.locator('app-side-drawer').filter({ hasText: 'Waste Filters' }));
    this.reviewNote = page.locator('#waste-review-note');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.waste);
    await this.heading.waitFor();
  }

  public async openFilters(): Promise<void> {
    await this.filtersButton.click();
    await this.page.getByText('Waste Filters').waitFor();
  }

  public async closeFilters(): Promise<void> {
    await this.page.getByRole('button', { name: /close/i }).first().click();
  }

  public async chooseStatus(label: string): Promise<void> {
    await this.page.getByRole('radiogroup', { name: 'Status' }).getByText(label, { exact: true }).click();
  }

  public async chooseReason(label: string): Promise<void> {
    await this.page.getByRole('radiogroup', { name: 'Reason' }).getByText(label, { exact: true }).click();
  }

  public async chooseDateRange(label: string): Promise<void> {
    await this.page.getByRole('radiogroup', { name: 'Date range' }).getByText(label, { exact: true }).click();
  }

  public entry(id: string): Locator {
    return this.page.getByTestId(`waste-${id}`);
  }

  public async review(id: string, action: 'Confirm' | 'Dispute' | 'Reverse', note?: string): Promise<void> {
    await this.entry(id).getByRole('button', { name: action, exact: true }).click();
    if (note !== undefined) {
      await this.reviewNote.fill(note);
    }

    await this.page.getByRole('dialog').getByRole('button', { name: action, exact: true }).click();
  }
}
