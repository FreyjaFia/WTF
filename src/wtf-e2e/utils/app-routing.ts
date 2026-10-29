import { BrowserContext } from '@playwright/test';
import { API_ORIGIN, APP_API_ORIGIN } from '@data/env';

// The app is built to call the API at APP_API_ORIGIN (environment.development.ts). The tests run their own API on
// API_ORIGIN against the throwaway database, so every browser context sends the app's API calls there instead.
export async function routeAppApiToTestApi(context: BrowserContext): Promise<void> {
  if (APP_API_ORIGIN === API_ORIGIN) {
    return;
  }

  await context.route(`${APP_API_ORIGIN}/**`, (route) => {
    const url = route.request().url().replace(APP_API_ORIGIN, API_ORIGIN);
    return route.continue({ url });
  });
}
