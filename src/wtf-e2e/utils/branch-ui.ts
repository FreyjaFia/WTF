import { Page, expect } from '@playwright/test';
import { Api } from '@api/index';
import { NewContext } from '@fixtures/index';

export const BRANCH_KEY = 'wtf_active_branch';

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

export interface OpenOptions {
  // What the browser remembers as the working branch before the app starts (undefined: nothing saved).
  readonly storedBranch?: string;
  readonly width?: number;
  readonly height?: number;
}

// A page for someone who is already signed in, with the saved branch set once before the app starts. The saved values are
// written only on the first load of the tab, so a later reload or a logout is not undone by the test.
export async function openAs(api: Api, newContext: NewContext, user: Credentials, options: OpenOptions = {}): Promise<Page> {
  const response = await api.client.login(user.username, user.password);
  expect(response.ok(), `login ${user.username} -> ${response.status()}`).toBeTruthy();
  const login = (await response.json()) as { accessToken: string; refreshToken?: string };

  const context = await newContext({ width: options.width, height: options.height });
  await context.addInitScript(
    ([token, refresh, branch, key]) => {
      if (sessionStorage.getItem('branch-test-seeded')) {
        return;
      }

      sessionStorage.setItem('branch-test-seeded', '1');
      localStorage.setItem('token', token);
      if (refresh) {
        localStorage.setItem('refreshToken', refresh);
      }

      if (branch) {
        localStorage.setItem(key, branch);
      }
    },
    [login.accessToken, login.refreshToken ?? '', options.storedBranch ?? '', BRANCH_KEY],
  );
  return context.newPage();
}

export async function storedBranch(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), BRANCH_KEY);
}

export const RAW_ERROR_TEXT =
  /cannot use that branch|forbidden|something went wrong|unauthori[sz]ed|pick a branch first|ask the owner to assign/i;
