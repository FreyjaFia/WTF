import { Page } from '@playwright/test';
import { API_ORIGIN } from '@data/env';

const APP_ORIGIN: string = process.env.E2E_APP_ORIGIN ?? 'http://localhost:4300';

export interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export const VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'phone 375', width: 375, height: 812 },
  { name: 'tablet 820', width: 820, height: 1180 },
  { name: 'desktop 1440', width: 1440, height: 900 },
];

export interface Overflow {
  readonly innerWidth: number;
  readonly document: number;
  readonly body: number;
  readonly content: number;
  readonly contentClient: number;
}

export async function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const content = document.querySelector('.app-content');
    return {
      innerWidth: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      content: content?.scrollWidth ?? 0,
      contentClient: content?.clientWidth ?? 0,
    };
  });
}

export function overflowProblem(overflow: Overflow): string | null {
  if (overflow.document > overflow.innerWidth || overflow.body > overflow.innerWidth) {
    return `page scrolls sideways: document ${overflow.document}, body ${overflow.body}, window ${overflow.innerWidth}`;
  }

  if (overflow.content > overflow.contentClient + 1) {
    return `content area scrolls sideways: ${overflow.content} wide in ${overflow.contentClient}`;
  }

  return null;
}

export interface Watcher {
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
  reset(): void;
}

export function watch(page: Page): Watcher {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    // A failed request to another host (Firebase, fonts) is not ours to fix; one to the app or the API is.
    const url = message.location().url;
    if (url && !url.startsWith(APP_ORIGIN) && !url.startsWith(API_ORIGIN)) {
      return;
    }

    consoleErrors.push(url ? `${message.text()} (${url})` : message.text());
  });
  return {
    pageErrors,
    consoleErrors,
    reset: (): void => {
      pageErrors.length = 0;
      consoleErrors.length = 0;
    },
  };
}

export async function useStyle(page: Page, style: 'light' | 'cafe'): Promise<void> {
  await page.evaluate((value) => localStorage.setItem('wtf-theme', value), style);
}
