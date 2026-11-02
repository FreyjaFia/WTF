import { execFileSync } from 'child_process';
import { Download, Page, TestInfo } from '@playwright/test';
import { MIN_DOWNLOAD_BYTES } from '@data/enums';
import * as fs from 'fs';

export interface SavedDownload {
  readonly fileName: string;
  readonly size: number;
  readonly path: string;
}

export async function captureDownload(page: Page, info: TestInfo, trigger: () => Promise<void>): Promise<SavedDownload> {
  const [download]: [Download, void] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const fileName = download.suggestedFilename();
  const file = info.outputPath(fileName);
  await download.saveAs(file);
  return { fileName, size: fs.statSync(file).size, path: file };
}

export function isUsableDownload(saved: SavedDownload): boolean {
  return saved.size > MIN_DOWNLOAD_BYTES;
}

export function readXlsxStrings(file: string): string {
  const entry = 'xl/sharedStrings.xml';
  const attempts: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['unzip', ['-p', file, entry]],
    ['tar', ['-xOf', file, entry]],
  ];

  for (const [command, args] of attempts) {
    try {
      return execFileSync(command, [...args], { encoding: 'utf8', maxBuffer: 20_000_000 }).replace(/<[^>]*>/g, ' ');
    } catch {
      // Try the next tool: Windows reads zip files with tar, Linux with unzip.
    }
  }

  throw new Error(`Could not read ${entry} from ${file}`);
}
