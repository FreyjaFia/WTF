import { Page } from '@playwright/test';

// Deep app routes keep loading assets, so waiting for "commit" is enough; specs then wait on visible content.
export async function go(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'commit' });
}
