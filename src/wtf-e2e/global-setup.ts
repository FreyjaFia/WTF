import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_ORIGIN, testPassword } from './data/env';
import { Role, USERNAMES } from './data/users';

export const AUTH_DIR: string = join(__dirname, '.auth');
export const APP_ORIGIN: string = process.env.E2E_APP_ORIGIN ?? 'http://localhost:4300';

export function authFile(role: Role): string {
  return join(AUTH_DIR, `${role}.json`);
}

// Signs every test account in once through the API and saves what the app keeps in the browser (the tokens in local
// storage), so tests start already signed in instead of typing the login form each time. The tokens last 60 minutes.
export default async function globalSetup(): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });

  for (const role of Object.keys(USERNAMES) as Role[]) {
    const response = await fetch(`${API_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAMES[role], password: testPassword() }),
    });
    if (!response.ok) {
      throw new Error(`Could not sign ${role} in for the saved session: ${response.status} ${await response.text()}`);
    }

    const login = (await response.json()) as { accessToken: string; refreshToken?: string };
    const localStorage = [{ name: 'token', value: login.accessToken }];
    if (login.refreshToken) {
      localStorage.push({ name: 'refreshToken', value: login.refreshToken });
    }

    writeFileSync(authFile(role), JSON.stringify({ cookies: [], origins: [{ origin: APP_ORIGIN, localStorage }] }));
  }
}
