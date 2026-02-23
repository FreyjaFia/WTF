import { Injectable } from '@angular/core';

/**
 * Lightweight stack that tracks open modals/dialogs so the Capacitor
 * hardware back-button can close the top-most one instead of navigating.
 *
 * Usage:
 *   const id = this.modalStack.push(() => this.close());
 *   // later, when the modal closes from any trigger:
 *   this.modalStack.remove(id);
 */
@Injectable({ providedIn: 'root' })
export class ModalStackService {
  private nextId = 0;
  private readonly stack: { id: number; close: () => void }[] = [];

  /** Register an open modal. Returns an ID to deregister later. */
  public push(closeFn: () => void): number {
    const id = this.nextId++;
    this.stack.push({ id, close: closeFn });
    return id;
  }

  /** Remove a modal by its registration ID (safe to call more than once). */
  public remove(id: number): void {
    const idx = this.stack.findIndex((entry) => entry.id === id);

    if (idx !== -1) {
      this.stack.splice(idx, 1);
    }
  }

  /** Close the top-most modal and remove it from the stack. Returns true if a modal was closed. */
  public pop(): boolean {
    const entry = this.stack.pop();

    if (entry) {
      entry.close();
      return true;
    }

    return false;
  }

  /** Whether any modals are currently registered. */
  public hasOpen(): boolean {
    return this.stack.length > 0;
  }
}
