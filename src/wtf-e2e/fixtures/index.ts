import { Browser, BrowserContext, Page, test as base } from '@playwright/test';
import { Api } from '@api/index';
import { testPassword } from '@data/env';
import { Role, USERNAMES } from '@data/users';
import { LoginPage } from '@pages/login.page';
import { routeAppApiToTestApi } from '@utils/app-routing';
import { authFile } from '../global-setup';

export interface SignInOptions {
  // Open the app the way a login does, so the page ends on the role's start page. Without it the page is blank and the
  // test navigates itself, which skips one full page load.
  readonly landing?: boolean;
}

export type SignIn = (role: Role, options?: SignInOptions) => Promise<Page>;
export type SignInViaUi = (role: Role) => Promise<Page>;
export type NewContext = (options?: { width?: number; height?: number }) => Promise<BrowserContext>;

interface Fixtures {
  readonly api: Api;
  // A page that is already signed in (the session saved by global-setup).
  readonly signIn: SignIn;
  // A page signed in by typing the login form, for the tests that are about the login itself.
  readonly signInViaUi: SignInViaUi;
  readonly newContext: NewContext;
}

async function createContext(browser: Browser, width: number, height: number, storageState?: string): Promise<BrowserContext> {
  const context = await browser.newContext({ timezoneId: 'Asia/Manila', viewport: { width, height }, storageState });
  await routeAppApiToTestApi(context);
  return context;
}

export const test = base.extend<Fixtures>({
  // The default `page` talks to the test API too.
  context: async ({ context }, use) => {
    await routeAppApiToTestApi(context);
    await use(context);
  },
  api: async ({ request }, use) => {
    await use(new Api(request));
  },
  // A fresh, signed-out browser context whose API calls go to the test API (closed after the test).
  newContext: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await createContext(browser, options.width ?? 1440, options.height ?? 900);
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
  signIn: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role: Role, options: SignInOptions = {}) => {
      const context = await createContext(browser, 1440, 900, authFile(role));
      contexts.push(context);
      const page = await context.newPage();
      if (options.landing) {
        await page.goto('/login', { waitUntil: 'commit' });
        await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      }

      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
  signInViaUi: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role: Role) => {
      const context = await createContext(browser, 1440, 900);
      contexts.push(context);
      const page = await context.newPage();
      await new LoginPage(page).signIn(USERNAMES[role], testPassword());
      await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect } from '@playwright/test';
