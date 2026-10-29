import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { API_ORIGIN, TIME_ZONE, testPassword } from '@data/env';
import { Role, USERNAMES } from '@data/users';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CallOptions {
  readonly body?: unknown;
  readonly accept?: string;
}

export class ApiClient {
  private static readonly tokens: Map<string, string> = new Map<string, string>();

  public constructor(private readonly request: APIRequestContext) {}

  public async tokenFor(role: Role): Promise<string> {
    return this.tokenForUser(USERNAMES[role], testPassword());
  }

  public async tokenForUser(username: string, password: string): Promise<string> {
    const cached = ApiClient.tokens.get(username);
    if (cached) {
      return cached;
    }

    const response = await this.login(username, password);
    expect(response.ok(), `login ${username} -> ${response.status()}`).toBeTruthy();
    const token: string = (await response.json()).accessToken;
    ApiClient.tokens.set(username, token);
    return token;
  }

  public async login(username: string, password: string): Promise<APIResponse> {
    return this.request.post(`${API_ORIGIN}/api/auth/login`, { data: { username, password } });
  }

  public async call(role: Role | null, method: HttpMethod, path: string, options: CallOptions = {}): Promise<APIResponse> {
    const token = role ? await this.tokenFor(role) : null;
    return this.callWithToken(token, method, path, options);
  }

  public async callWithToken(token: string | null, method: HttpMethod, path: string, options: CallOptions = {}): Promise<APIResponse> {
    const headers: Record<string, string> = { 'X-TimeZone': TIME_ZONE };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (options.accept) {
      headers.Accept = options.accept;
    }

    return this.request.fetch(`${API_ORIGIN}/api/${path.replace(/^\//, '')}`, { method, headers, data: options.body });
  }

  public async json<T>(role: Role | null, method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const response = await this.call(role, method, path, { body });
    return ApiClient.parse<T>(response, `${method} ${path}`);
  }

  public static async parse<T>(response: APIResponse, label: string): Promise<T> {
    const text = await response.text();
    expect(response.ok(), `${label} -> ${response.status()} ${text}`).toBeTruthy();
    return (text ? JSON.parse(text) : null) as T;
  }

  public static async messageOf(response: APIResponse): Promise<string> {
    return response.text();
  }
}
