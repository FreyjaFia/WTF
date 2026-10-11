import { convertToParamMap } from '@angular/router';
import { vi } from 'vitest';

/** Loose view of a component so specs can reach protected members. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Internals = any;

export function internals(component: unknown): Internals {
  return component as Internals;
}

export function fakeAlert() {
  return {
    error: vi.fn(),
    success: vi.fn(),
    errorUnauthorized: vi.fn(),
    errorInvalidImageType: vi.fn(),
    errorFileTooLarge: vi.fn(),
    errorNothingToUpdate: vi.fn(),
    successCreated: vi.fn(),
    successUpdated: vi.fn(),
    successDeleted: vi.fn(),
    successRestored: vi.fn(),
    successUploaded: vi.fn(),
    getDeleteErrorMessage: vi.fn((e: string) => `Failed to delete ${e}.`),
    getUploadErrorMessage: vi.fn((e: string) => `Failed to upload ${e}.`),
    getUpdateErrorMessage: vi.fn((e: string) => `Failed to update ${e}.`),
  };
}

export function fakeListState(saved?: unknown) {
  return {
    load: vi.fn((_key: string, fallback: unknown) => saved ?? fallback),
    save: vi.fn(),
  };
}

export function stubRoute(params: Record<string, string> = {}, data: Record<string, unknown> = {}) {
  return { snapshot: { paramMap: convertToParamMap(params), data } };
}

export function fileOf(type: string, size = 10, name = 'f.png'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}
