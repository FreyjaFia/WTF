import { Page } from '@playwright/test';
import { API_ORIGIN, APP_API_ORIGIN } from '@data/env';

export interface SyncResult {
  offlineLocalId: string | null;
  orderId: string | null;
  orderNumber: number | null;
  status: number | null;
  reasons: string[];
  reasonDetails?: { code: string; severity: 'Hold' | 'Note'; text: string }[];
  error: string | null;
  stockWarnings?: string[] | null;
}

export interface SyncSpy {
  // The orders the app sent, one list per request.
  readonly sent: Record<string, unknown>[][];
  // Stop changing answers; the real API's answer goes through as it is.
  release(): Promise<void>;
}

// The API of this branch does not send reasonDetails yet. The app sends the real request to the real API and gets the
// real answer back; `change` then adds what the new API will add, so the cashier feedback can be checked end to end.
export async function changeSyncAnswers(page: Page, change: (results: SyncResult[]) => SyncResult[]): Promise<SyncSpy> {
  const sent: Record<string, unknown>[][] = [];
  const pattern = '**/api/orders/sync';
  await page.route(pattern, async (route) => {
    const body = route.request().postDataJSON() as { orders: Record<string, unknown>[] };
    sent.push(body.orders);
    const response = await route.fetch({ url: route.request().url().replace(APP_API_ORIGIN, API_ORIGIN) });
    const results = (await response.json()) as SyncResult[];
    await route.fulfill({ response, json: change(results) });
  });

  return { sent, release: () => page.unroute(pattern) };
}
