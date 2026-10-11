/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComponentFixture } from '@angular/core/testing';

/** Loose view onto a component so specs can reach protected/private members. */
export type Internals = Record<string, any>;

export function internals(target: unknown): Internals {
  return target as Internals;
}

export function internalsOf(fixture: ComponentFixture<unknown>): Internals {
  return fixture.componentInstance as Internals;
}

/** Waits for pending microtasks/promises (real timers only). */
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
