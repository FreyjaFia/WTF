import { computed, effect, Signal, signal, untracked, WritableSignal } from '@angular/core';
import { isCoveredLine, rowAmounts, seniorPwdReduction, totalsByPerson } from '@shared/calculations';
import type { CartItemDto, SeniorPwdPersonRequestDto } from '@shared/models';
import type { SeniorPwdLineOption } from '../senior-pwd-dialog/senior-pwd-dialog';
import {
  applySelections,
  dropUnusedPersons,
  selectionsFromCart,
  SeniorPwdSelection,
  seniorPwdCommandPart,
  uncoverLines,
} from './order-editor-senior-pwd';

export interface OrderEditorSeniorPwdHost {
  cart: WritableSignal<CartItemDto[]>;
  vatRegistered: Signal<boolean>;
  canApply: () => boolean;
  isBusy: () => boolean;
  blockedReasonOf: (line: CartItemDto) => string | null;
}

export class OrderEditorSeniorPwd {
  public readonly persons = signal<SeniorPwdPersonRequestDto[]>([]);
  public readonly showDialog = signal(false);

  public readonly lineAmounts = computed(() => rowAmounts(this.host.cart(), this.host.vatRegistered()));
  public readonly totals = computed(() =>
    totalsByPerson(this.host.cart(), this.persons().length, this.host.vatRegistered()),
  );
  public readonly options = computed<SeniorPwdLineOption[]>(() =>
    uncoverLines(this.host.cart()).map((line) => ({
      line,
      blockedReason: this.host.blockedReasonOf(line),
    })),
  );
  public readonly selections = computed<SeniorPwdSelection[]>(
    () => selectionsFromCart(this.host.cart(), this.persons()).selections,
  );
  public readonly conflict = computed(() =>
    this.host.cart().some((line) => isCoveredLine(line) && this.host.blockedReasonOf(line) !== null),
  );

  public constructor(private readonly host: OrderEditorSeniorPwdHost) {
    // A person whose lines are all gone is dropped, so the discount never lists someone who covers nothing.
    effect(() => {
      const cart = this.host.cart();
      const persons = this.persons();
      if (persons.length === 0 && !cart.some(isCoveredLine)) {
        return;
      }

      untracked(() => this.prune(cart, persons));
    });
  }

  public lineReduction(index: number): number {
    const amounts = this.lineAmounts()[index];
    return amounts ? seniorPwdReduction(amounts) : 0;
  }

  public isCoveredByPerson(line: CartItemDto): boolean {
    return isCoveredLine(line) && !!this.persons()[line.seniorPwdPersonIndex!];
  }

  public hasAnything(): boolean {
    return this.persons().length > 0 || this.host.cart().some(isCoveredLine);
  }

  public commandPart(): { seniorPwdPersons?: SeniorPwdPersonRequestDto[] } {
    return seniorPwdCommandPart(this.persons());
  }

  public open(): void {
    if (!this.host.canApply() || this.host.isBusy()) {
      return;
    }

    this.showDialog.set(true);
  }

  public close(): void {
    this.showDialog.set(false);
  }

  public apply(selections: SeniorPwdSelection[]): void {
    const lines = uncoverLines(this.host.cart());
    const { cart, persons } = applySelections(lines, selections);
    this.host.cart.set(cart);
    this.persons.set(persons);
    this.showDialog.set(false);
  }

  public remove(): void {
    this.uncoverAll();
    this.showDialog.set(false);
  }

  public uncoverAll(): void {
    this.host.cart.set(uncoverLines(this.host.cart()));
    this.persons.set([]);
  }

  private prune(cart: CartItemDto[], persons: SeniorPwdPersonRequestDto[]): void {
    const pruned = dropUnusedPersons(cart, persons);
    if (pruned) {
      this.persons.set(pruned.persons);
      this.host.cart.set(pruned.cart);
    }
  }
}
