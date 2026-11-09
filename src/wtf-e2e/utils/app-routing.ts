import { BrowserContext } from '@playwright/test';
import { API_ORIGIN, APP_API_ORIGIN } from '@data/env';

// The app is built to call the API at APP_API_ORIGIN (environment.development.ts). The tests run their own API on
// API_ORIGIN against the throwaway database, so every browser context sends the app's API calls there instead.
// Requests can be re-routed, but a WebSocket cannot, so the page's own WebSocket constructor swaps the address.
export async function routeAppApiToTestApi(context: BrowserContext): Promise<void> {
  if (APP_API_ORIGIN === API_ORIGIN) {
    return;
  }

  await context.route(`${APP_API_ORIGIN}/**`, (route) => {
    const url = route.request().url().replace(APP_API_ORIGIN, API_ORIGIN);
    return route.continue({ url });
  });

  await context.addInitScript(
    ({ from, to }) => {
      const NativeWebSocket = window.WebSocket;
      const swap = (url: string | URL): string | URL => (String(url).startsWith(from) ? String(url).replace(from, to) : url);
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct: (target, args: [string | URL, (string | string[])?]) => new target(swap(args[0]), args[1]),
      });
    },
    { from: APP_API_ORIGIN.replace(/^http/, 'ws'), to: API_ORIGIN.replace(/^http/, 'ws') },
  );
}
