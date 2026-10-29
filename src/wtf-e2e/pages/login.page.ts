import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class LoginPage {
  public readonly username: Locator;
  public readonly password: Locator;
  public readonly submit: Locator;

  public constructor(private readonly page: Page) {
    this.username = page.locator('#username');
    this.password = page.locator('#password');
    this.submit = page.locator('button[type="submit"]');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.login);
    await this.username.waitFor();
  }

  public async signIn(username: string, password: string): Promise<void> {
    await this.open();
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
  }
}
