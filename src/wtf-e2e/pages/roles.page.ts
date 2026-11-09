import { Locator, Page } from '@playwright/test';
import { go } from '@utils/navigation';

export class RoleListPage {
  public readonly newRole: Locator;
  public readonly search: Locator;
  public readonly dialog: Locator;

  public constructor(private readonly page: Page) {
    this.newRole = page.getByTestId('new-role');
    this.search = page.getByPlaceholder(/search/i).and(page.locator('input')).first();
    this.dialog = page.locator('app-confirm-dialog').getByRole('dialog');
  }

  public async open(): Promise<void> {
    await go(this.page, '/management/roles');
    await this.newRole.waitFor();
  }

  public row(name: string): Locator {
    return this.page.locator('[data-testid^="role-row-"]').filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }

  public async actions(name: string): Promise<void> {
    await this.row(name).getByRole('button', { name: 'Role actions' }).click();
  }
}

export class RoleEditorPage {
  public readonly name: Locator;
  public readonly description: Locator;
  public readonly save: Locator;
  public readonly summary: Locator;
  public readonly duplicate: Locator;
  public readonly scroller: Locator;

  public constructor(private readonly page: Page) {
    this.name = page.getByTestId('role-name');
    this.description = page.getByTestId('role-description');
    this.save = page.getByTestId('save-role');
    this.summary = page.getByTestId('role-summary');
    this.duplicate = page.getByTestId('duplicate-role');
    this.scroller = page.locator('app-role-editor .overflow-y-auto').first();
  }

  public async openNew(): Promise<void> {
    await go(this.page, '/management/roles/new');
    await this.name.waitFor();
  }

  public async openRole(id: number): Promise<void> {
    await go(this.page, `/management/roles/${id}`);
    await this.page.getByTestId('area-Orders').waitFor();
  }

  public permission(key: string): Locator {
    return this.page.getByTestId(`perm-${key}`);
  }
}
