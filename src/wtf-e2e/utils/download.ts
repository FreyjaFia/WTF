import { Download, Page, TestInfo } from '@playwright/test';
import { MIN_DOWNLOAD_BYTES } from '@data/enums';
import * as fs from 'fs';

export interface SavedDownload {
  readonly fileName: string;
  readonly size: number;
}

export async function captureDownload(page: Page, info: TestInfo, trigger: () => Promise<void>): Promise<SavedDownload> {
  const [download]: [Download, void] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const fileName = download.suggestedFilename();
  const file = info.outputPath(fileName);
  await download.saveAs(file);
  return { fileName, size: fs.statSync(file).size };
}

export function isUsableDownload(saved: SavedDownload): boolean {
  return saved.size > MIN_DOWNLOAD_BYTES;
}
