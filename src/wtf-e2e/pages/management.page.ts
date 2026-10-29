import { Locator, Page } from '@playwright/test';
import { go } from '@utils/navigation';

export class ManagementListPage {
  public readonly search: Locator;

  public constructor(private readonly page: Page, private readonly path: string) {
    this.search = page.getByPlaceholder(/search/i).and(page.locator('input')).first();
  }

  public async open(): Promise<void> {
    await go(this.page, this.path);
    await this.search.waitFor();
  }

  public async find(text: string): Promise<void> {
    await this.search.fill(text);
  }

  public row(name: string): Locator {
    return this.page.getByLabel(`View details for ${name}`);
  }
}

export class DetailsActions {
  public readonly deleteButton: Locator;
  public readonly restoreButton: Locator;
  public readonly editLink: Locator;
  public readonly dialog: Locator;
  public readonly inactiveBadge: Locator;

  public constructor(private readonly page: Page) {
    this.deleteButton = page.getByRole('button', { name: 'Delete', exact: true });
    this.restoreButton = page.getByRole('button', { name: 'Restore', exact: true });
    this.editLink = page.getByRole('link', { name: 'Edit', exact: true });
    this.dialog = page.locator('app-confirm-dialog').getByRole('dialog');
    this.inactiveBadge = page.getByText('Inactive', { exact: true }).first();
  }

  public dialogButton(name: RegExp | string): Locator {
    return this.dialog.getByRole('button', { name });
  }
}

export class ProductEditorPage {
  public readonly name: Locator;
  public readonly code: Locator;
  public readonly price: Locator;
  public readonly category: Locator;
  public readonly submit: Locator;
  public readonly title: Locator;

  public constructor(private readonly page: Page) {
    this.name = page.locator('#productName');
    this.code = page.locator('#productCode');
    this.price = page.locator('#productPrice');
    this.category = page.locator('#productCategory');
    this.submit = page.getByRole('button', { name: /^(Create|Update) Product$/ });
    this.title = page.getByRole('heading', { level: 1 });
  }

  public async openNew(): Promise<void> {
    await go(this.page, '/management/products/new');
    await this.name.waitFor();
  }

  public errorText(text: RegExp | string): Locator {
    return this.page.locator('p.text-error').filter({ hasText: text });
  }
}

export class CustomerEditorPage {
  public readonly firstName: Locator;
  public readonly lastName: Locator;
  public readonly contact: Locator;
  public readonly address: Locator;
  public readonly submit: Locator;

  public constructor(private readonly page: Page) {
    this.firstName = page.locator('#firstName');
    this.lastName = page.locator('#lastName');
    this.contact = page.locator('#customerContact');
    this.address = page.locator('#customerAddress');
    this.submit = page.getByRole('button', { name: /^(Create|Update) Customer$/ });
  }

  public async openNew(): Promise<void> {
    await go(this.page, '/management/customers/new');
    await this.firstName.waitFor();
  }

  public errorText(text: RegExp | string): Locator {
    return this.page.locator('p.text-error').filter({ hasText: text });
  }
}

export class ItemEditorPage {
  public readonly name: Locator;
  public readonly unit: Locator;
  public readonly startingQuantity: Locator;
  public readonly submit: Locator;
  public readonly back: Locator;
  public readonly discardDialog: Locator;

  public constructor(private readonly page: Page) {
    this.name = page.locator('#itemName');
    this.unit = page.locator('#itemUnit');
    this.startingQuantity = page.locator('#startingQuantity');
    this.submit = page.getByRole('button', { name: /^(Create|Update) Item$/ });
    this.back = page.getByRole('button', { name: 'Go back' });
    this.discardDialog = page.getByRole('dialog').filter({ hasText: 'Discard Changes?' });
  }

  public async openNew(): Promise<void> {
    await go(this.page, '/inventory/items/new');
    await this.name.waitFor();
  }

  public errorText(text: RegExp | string): Locator {
    return this.page.locator('p.text-error').filter({ hasText: text });
  }
}

export class SidebarPage {
  public readonly root: Locator;

  public constructor(private readonly page: Page) {
    this.root = page.locator('app-sidebar');
  }

  public link(path: string): Locator {
    return this.root.locator(`a[href="${path}"]`);
  }
}
