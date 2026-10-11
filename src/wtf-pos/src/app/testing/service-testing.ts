import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { Provider, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConnectivityService } from '@core/services/connectivity.service';
import { vi } from 'vitest';

export interface FakeConnectivity {
  checkNow: ReturnType<typeof vi.fn>;
}

export function createFakeConnectivity(): FakeConnectivity {
  return { checkNow: vi.fn() };
}

/**
 * Configures TestBed for an HTTP-backed service with a fake ConnectivityService and returns
 * the service, the HTTP controller and the fake. Silences console.error from error paths.
 */
export function setupHttpService<T>(
  service: Type<T>,
  extraProviders: Provider[] = [],
): { service: T; http: HttpTestingController; connectivity: FakeConnectivity } {
  const connectivity = createFakeConnectivity();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ConnectivityService, useValue: connectivity },
      ...extraProviders,
    ],
  });
  return {
    service: TestBed.inject(service),
    http: TestBed.inject(HttpTestingController),
    connectivity,
  };
}

/** Subscribes and captures either the emitted value or the thrown error message. */
export function capture<T>(source: {
  subscribe: (o: { next: (v: T) => void; error: (e: unknown) => void }) => unknown;
}): { value?: T; error?: string; emissions: number } {
  const out: { value?: T; error?: string; emissions: number } = { emissions: 0 };
  source.subscribe({
    next: (v) => {
      out.value = v;
      out.emissions++;
    },
    error: (e) => {
      out.error = e instanceof Error ? e.message : String(e);
    },
  });
  return out;
}

export function failWith(req: TestRequest, status: number, body: unknown = null): void {
  req.flush(body as Parameters<TestRequest["flush"]>[0], { status, statusText: `HTTP ${status}` });
}

/** Network-level failure (status 0). */
export function failNetwork(req: TestRequest): void {
  req.error(new ProgressEvent('error'), { status: 0 });
}
