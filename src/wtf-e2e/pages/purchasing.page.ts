import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

// The app's searchable dropdown: the trigger carries the test id, each option carries `<testId>-option`.
export async function chooseOption(page: Page, testId: string, label: string): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByTestId(`${testId}-option`).filter({ hasText: label }).first().click();
}

export class SuppliersPage {
  public readonly heading: Locator;
  public readonly search: Locator;
  public readonly addButton: Locator;
  public readonly nameInput: Locator;
  public readonly showInactive: Locator;
  public readonly filtersButton: Locator;
  public readonly empty: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Suppliers', exact: true });
    this.search = page.getByLabel('Search suppliers');
    this.addButton = page.getByTestId('open-new');
    this.nameInput = page.locator('#supplier-name');
    this.showInactive = page.getByTestId('show-inactive');
    this.filtersButton = page.getByRole('button', { name: /filters/i }).first();
    this.empty = page.getByTestId('suppliers-empty');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.suppliers);
    await this.heading.waitFor();
  }

  public async setShowInactive(on: boolean): Promise<void> {
    await this.filtersButton.click();
    await this.page.getByText('Supplier Filters').waitFor();
    if (on) {
      await this.showInactive.check();
    } else {
      await this.showInactive.uncheck();
    }
    await this.page.getByRole('button', { name: /close/i }).first().click();
  }

  public row(name: string): Locator {
    return this.page.getByTestId('supplier-row').filter({ hasText: name });
  }
}

export class SupplierDetailsPage {
  public readonly title: Locator;
  public readonly saveButton: Locator;
  public readonly deactivate: Locator;
  public readonly restore: Locator;
  public readonly linkForm: Locator;
  public readonly confirm: Locator;

  public constructor(private readonly page: Page) {
    this.title = page.getByTestId('supplier-title');
    this.saveButton = page.getByTestId('save-supplier');
    this.deactivate = page.getByTestId('deactivate');
    this.restore = page.getByTestId('restore');
    this.linkForm = page.getByTestId('link-form');
    this.confirm = page.locator('app-confirm-dialog');
  }

  public async open(id: string): Promise<void> {
    await go(this.page, ROUTES.supplierById(id));
    await this.title.waitFor();
  }

  public itemRow(name: string): Locator {
    return this.page.getByTestId('supplier-item-row').filter({ hasText: name });
  }

  public async linkItem(itemName: string, pack: { name: string; units: number; price?: number }): Promise<void> {
    await chooseOption(this.page, 'lf-item', itemName);
    await this.page.locator('#lf-pack').fill(pack.name);
    await this.page.locator('#lf-units').fill(String(pack.units));
    if (pack.price !== undefined) {
      await this.page.locator('#lf-price').fill(String(pack.price));
    }

    await this.page.getByTestId('save-link').click();
  }
}

export class ReorderPage {
  public readonly heading: Locator;
  public readonly empty: Locator;
  public readonly parToggle: Locator;
  public readonly parPanel: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Reorder', exact: true });
    this.empty = page.getByTestId('reorder-empty');
    this.parToggle = page.getByTestId('toggle-par');
    this.parPanel = page.getByTestId('par-panel');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.reorder);
    await this.heading.waitFor();
  }

  public group(supplierName: string): Locator {
    return this.page.getByTestId('reorder-group').filter({ hasText: supplierName });
  }

  public line(itemName: string): Locator {
    return this.page.getByTestId('reorder-line').filter({ hasText: itemName });
  }

  public parRow(itemName: string): Locator {
    return this.page.getByTestId('par-row').filter({ hasText: itemName });
  }
}

export class ReceivingPage {
  public readonly heading: Locator;
  public readonly receiveButton: Locator;
  public readonly form: Locator;
  public readonly saveButton: Locator;
  public readonly search: Locator;
  public readonly total: Locator;
  public readonly difference: Locator;
  public readonly empty: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Receiving', exact: true });
    this.receiveButton = page.getByTestId('open-receipt');
    this.form = page.getByTestId('receipt-form');
    this.saveButton = page.getByTestId('save-receipt');
    this.search = page.getByLabel('Search receipts');
    this.total = page.getByTestId('receipt-total');
    this.difference = page.getByTestId('receipt-difference');
    this.empty = page.getByTestId('receipts-empty');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.receiving);
    await this.heading.waitFor();
  }

  public row(text: string): Locator {
    return this.page.getByTestId('receipt-row').filter({ hasText: text });
  }

  public line(index: number): Locator {
    return this.page.getByTestId('receipt-line').nth(index);
  }

  public packs(index: number): Locator {
    return this.page.locator(`#rl-packs-${index}`);
  }

  public async chooseSupplier(name: string): Promise<void> {
    await chooseOption(this.page, 'rc-supplier', name);
  }

  public async chooseOrder(label: string): Promise<void> {
    await chooseOption(this.page, 'rc-order', label);
  }

  public async chooseItem(index: number, name: string): Promise<void> {
    await chooseOption(this.page, `rl-item-${index}`, name);
  }
}

export class OrdersPage {
  public readonly heading: Locator;
  public readonly newButton: Locator;
  public readonly form: Locator;
  public readonly saveButton: Locator;
  public readonly search: Locator;
  public readonly empty: Locator;
  public readonly confirm: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Purchase Orders', exact: true });
    this.newButton = page.getByTestId('open-order');
    this.form = page.getByTestId('order-form');
    this.saveButton = page.getByTestId('save-order');
    this.search = page.getByLabel('Search purchase orders');
    this.empty = page.getByTestId('orders-empty');
    this.confirm = page.locator('app-confirm-dialog');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.purchaseOrders);
    await this.heading.waitFor();
  }

  public row(poNumber: number): Locator {
    return this.page.getByTestId('order-row').filter({ hasText: new RegExp(`PO-${poNumber}\\b`) });
  }

  public status(poNumber: number): Locator {
    return this.row(poNumber).getByTestId('order-status');
  }

  public async expand(poNumber: number): Promise<void> {
    await this.row(poNumber).locator('button').first().click();
    await this.row(poNumber).getByTestId('order-detail').waitFor();
  }

  public async confirmWith(label: string): Promise<void> {
    await this.confirm.getByRole('button', { name: label, exact: true }).click();
  }

  public async filterByStatus(label: string): Promise<void> {
    await this.page.getByRole('button', { name: /filters/i }).first().click();
    await this.page.getByText('Purchase Order Filters').waitFor();
    await this.page.getByTestId('status-filter').getByText(label, { exact: true }).click();
    await this.page.getByRole('button', { name: /close/i }).first().click();
  }
}
