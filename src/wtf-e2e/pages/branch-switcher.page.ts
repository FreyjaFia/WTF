import { Locator, Page, expect } from '@playwright/test';

export class BranchSwitcherPage {
  public readonly button: Locator;
  public readonly menu: Locator;
  public readonly options: Locator;

  public constructor(private readonly page: Page) {
    this.button = page.locator('[data-testid="branch-switcher-button"]:visible').first();
    this.menu = page.locator('[data-testid="branch-switcher-menu"]:visible');
    this.options = this.menu.locator('[data-testid^="branch-option-"]');
  }

  public option(code: string): Locator {
    return this.menu.locator(`[data-testid="branch-option-${code}"]`);
  }

  public async open(): Promise<void> {
    await this.button.click();
    await expect(this.menu).toBeVisible();
    await expect(this.menu).toHaveCSS('opacity', '1');
  }

  public async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.page.locator('body').click({ position: { x: 2, y: 2 } });
  }

  // The codes in the open menu, "all" for All branches, in the order they are listed.
  public async codes(): Promise<string[]> {
    const ids = await this.options.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''));
    return ids.map((id) => id.replace('branch-option-', ''));
  }

  public async logOut(): Promise<void> {
    await this.page.locator('.navbar .avatar:visible, aside.app-sidebar .avatar:visible').first().click();
    await this.page.getByText('Logout', { exact: true }).first().click();
    const confirm = this.page.getByRole('button', { name: 'Log out', exact: true });
    // The sidebar asks first; the header signs out at once. Wait for whichever comes, never peek before the dialog is drawn.
    await expect(confirm.or(this.page.locator('#username'))).toBeVisible();
    if (await confirm.isVisible()) {
      await confirm.click();
    }

    await this.page.waitForURL((url) => url.pathname.startsWith('/login'));
  }
}
