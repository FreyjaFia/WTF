import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ModalStackService {
  private nextId = 0;
  private readonly stack: { id: number; close: () => void }[] = [];

  public push(closeFn: () => void): number {
    const id = this.nextId++;
    this.stack.push({ id, close: closeFn });
    return id;
  }

  public remove(id: number): void {
    const idx = this.stack.findIndex((entry) => entry.id === id);

    if (idx !== -1) {
      this.stack.splice(idx, 1);
    }
  }

  public pop(): boolean {
    const entry = this.stack.pop();

    if (entry) {
      entry.close();
      return true;
    }

    return false;
  }

  public hasOpen(): boolean {
    return this.stack.length > 0;
  }
}
