import { Locator, Page } from '@playwright/test';
import { PLATFORM_USERNAME, testPassword } from '@data/env';
import { PLATFORM_ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class PlatformLoginPage {
  public readonly username: Locator;
  public readonly password: Locator;
  public readonly submit: Locator;

  public constructor(private readonly page: Page) {
    this.username = page.getByLabel('Name', { exact: true });
    this.password = page.getByLabel('Password', { exact: true });
    this.submit = page.getByRole('button', { name: /^Sign in/ });
  }

  public async open(): Promise<void> {
    await go(this.page, PLATFORM_ROUTES.login);
    await this.username.waitFor();
  }

  public async signIn(username: string = PLATFORM_USERNAME, password: string = testPassword()): Promise<void> {
    await this.open();
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
  }

  public async signInAndWait(username: string = PLATFORM_USERNAME, password: string = testPassword()): Promise<void> {
    await this.signIn(username, password);
    await this.page.waitForURL(/\/platform\/overview/);
  }
}

export class PlatformShell {
  public readonly nav: Locator;
  public readonly signOutButton: Locator;

  public constructor(private readonly page: Page) {
    this.nav = page.getByRole('complementary', { name: 'Platform navigation' });
    this.signOutButton = this.nav.getByRole('button', { name: 'Sign out' });
  }

  public link(name: 'Overview' | 'Shops' | 'Plans' | 'Logs'): Locator {
    return this.nav.getByRole('link', { name });
  }
}

export class PlatformDock {
  public readonly nav: Locator;
  public readonly signOutButton: Locator;

  public constructor(private readonly page: Page) {
    this.nav = page.getByRole('navigation', { name: 'Platform navigation' });
    this.signOutButton = page.getByRole('button', { name: 'Sign out' });
  }

  public link(name: 'Overview' | 'Shops' | 'Plans' | 'Logs'): Locator {
    return this.nav.getByRole('link', { name });
  }
}

export interface NewShopForm {
  readonly name: string;
  readonly slug: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly username: string;
  readonly trial?: boolean;
}

export class PlatformShopsPage {
  public readonly heading: Locator;
  public readonly newShopButton: Locator;
  public readonly search: Locator;
  public readonly dialog: Locator;
  public readonly secret: Locator;

  public constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Shops', exact: true });
    this.newShopButton = page.getByRole('button', { name: 'New shop' });
    this.search = page.getByLabel('Search shops');
    this.dialog = page.getByRole('dialog', { name: 'New shop' });
    this.secret = page.locator('app-platform-secret-dialog').getByRole('dialog');
  }

  public async open(): Promise<void> {
    await go(this.page, PLATFORM_ROUTES.shops);
    await this.heading.waitFor();
  }

  public row(slug: string): Locator {
    return this.page.getByTestId(`shop-${slug}`);
  }

  public get filtersButton(): Locator {
    return this.page.getByRole('button', { name: /^Filters/ });
  }

  public get filtersDrawerTitle(): Locator {
    return this.page.getByText('Shop Filters', { exact: true });
  }

  public statusFilter(id: 1 | 2 | 3 | 4): Locator {
    return this.page.getByTestId(`filter-status-${id}`);
  }

  public sortHeader(label: string): Locator {
    return this.page.getByTestId('shops-table').getByRole('button', { name: `Sort by ${label}`, exact: true });
  }

  public async rowSlugs(): Promise<string[]> {
    const ids = await this.page.getByTestId('shops-table').locator('[data-testid^="shop-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
    return ids.map((id) => id.replace(/^shop-/, ''));
  }

  public async fillAndCreate(form: NewShopForm): Promise<void> {
    await this.newShopButton.click();
    await this.dialog.getByLabel('Shop name').fill(form.name);
    await this.dialog.getByLabel('Shop address').fill(form.slug);
    await this.dialog.getByLabel('Owner first name').fill(form.firstName);
    await this.dialog.getByLabel('Owner last name').fill(form.lastName);
    await this.dialog.getByLabel('Owner username').fill(form.username);
    if (form.trial) {
      await this.dialog.getByLabel('Start as a trial').check();
    }

    await this.dialog.getByRole('button', { name: 'Create shop' }).click();
  }

  public async secretValues(): Promise<{ username: string; password: string }> {
    return {
      username: (await this.secret.getByTestId('secret-username').textContent())?.trim() ?? '',
      password: (await this.secret.getByTestId('secret-password').textContent())?.trim() ?? '',
    };
  }
}

export type ShopTab = 'overview' | 'people' | 'billing' | 'brand' | 'log';

export class PlatformShopPage {
  public readonly title: Locator;
  public readonly reasonDialog: Locator;
  public readonly secret: Locator;
  public readonly alert: Locator;

  public constructor(private readonly page: Page) {
    this.title = page.getByTestId('shop-title');
    this.reasonDialog = page.getByRole('dialog');
    this.secret = page.locator('app-platform-secret-dialog').getByRole('dialog');
    this.alert = page.getByRole('alert');
  }

  public async open(id: string): Promise<void> {
    await go(this.page, PLATFORM_ROUTES.shop(id));
    await this.title.waitFor();
  }

  public tab(name: ShopTab): Locator {
    return this.page.getByTestId(`tab-${name}`);
  }

  public async openTab(name: ShopTab): Promise<void> {
    await this.tab(name).click();
  }

  public button(name: string): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  public async confirmWithReason(reason: string, confirm: string = 'Confirm'): Promise<void> {
    await this.reasonDialog.getByLabel(/^Reason/).fill(reason);
    await this.reasonDialog.getByRole('button', { name: confirm }).click();
  }

  public person(username: string): Locator {
    return this.page.getByTestId('people-list').getByRole('listitem').filter({ hasText: username });
  }
}
