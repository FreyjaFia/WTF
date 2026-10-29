import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const API_ORIGIN: string = process.env.E2E_API_ORIGIN ?? 'http://localhost:5290';
export const APP_API_ORIGIN: string = process.env.E2E_APP_API_ORIGIN ?? 'http://localhost:5290';
export const TIME_ZONE: string = 'Asia/Manila';

const PASSWORD_FILE: string = join(__dirname, '..', '.e2e-password');

// E2E_PASSWORD wins; otherwise the password run.ps1 saved when it first made the throwaway database.
export function testPassword(): string {
  const value = (process.env.E2E_PASSWORD ?? (existsSync(PASSWORD_FILE) ? readFileSync(PASSWORD_FILE, 'utf8') : '')).trim();
  if (!value) {
    throw new Error('No test password. Run .\\run.ps1 once (it makes one) or set E2E_PASSWORD to the throwaway accounts\' password.');
  }

  return value;
}
