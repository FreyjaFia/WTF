import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { ConnectivityService, OrderService } from '@core/services';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { CartItemDto, SENIOR_PWD_TYPE_LABELS, SeniorPwdTypeEnum } from '@shared/models';
import {
  applySelections,
  coveredQuantityOf,
  SeniorPwdSelection,
  totalsByPerson,
} from '../order-editor/order-editor-senior-pwd';

export const SENIOR_PWD_ID_MAX_LENGTH = 30;
export const SENIOR_PWD_NAME_MAX_LENGTH = 100;
const ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} \-/.]*$/u;

export interface SeniorPwdLineOption {
  line: CartItemDto;
  // Why this line cannot be covered; null when it can.
  blockedReason: string | null;
}

interface PersonState {
  type: SeniorPwdTypeEnum;
  idNumber: string;
  customerName: string;
  picks: Record<number, number>;
}

@Component({
  selector: 'app-senior-pwd-dialog',
  imports: [DecimalPipe, IconComponent],
  templateUrl: './senior-pwd-dialog.html',
  host: { class: 'contents' },
})
export class SeniorPwdDialogComponent implements OnInit {
  private readonly orderService = inject(OrderService);
  private readonly connectivity = inject(ConnectivityService);

  public readonly options = input.required<SeniorPwdLineOption[]>();
  public readonly initial = input<SeniorPwdSelection[]>([]);
  public readonly vatRegistered = input(false);

  public readonly applied = output<SeniorPwdSelection[]>();
  public readonly cleared = output<void>();
  public readonly cancelled = output<void>();

  protected readonly SeniorPwdTypeEnum = SeniorPwdTypeEnum;
  protected readonly types = [SeniorPwdTypeEnum.Senior, SeniorPwdTypeEnum.Pwd];
  protected readonly typeLabels = SENIOR_PWD_TYPE_LABELS;
  protected readonly idMaxLength = SENIOR_PWD_ID_MAX_LENGTH;
  protected readonly nameMaxLength = SENIOR_PWD_NAME_MAX_LENGTH;

  protected readonly people = signal<PersonState[]>([]);
  protected readonly showErrors = signal(false);
  protected readonly idWarnings = signal<Record<number, string>>({});

  protected readonly hasApplied = computed(() => this.initial().length > 0);
  protected readonly hasCoverableLine = computed(() =>
    this.options().some((option) => !option.blockedReason),
  );

  private readonly selections = computed<SeniorPwdSelection[]>(() =>
    this.people().map((person) => ({
      person: { type: person.type, idNumber: person.idNumber, customerName: person.customerName },
      picks: person.picks,
    })),
  );

  protected readonly totals = computed(() => {
    const { cart, persons } = applySelections(
      this.options().map((option) => option.line),
      this.selections(),
    );
    const byPerson = totalsByPerson(cart, persons.length, this.vatRegistered());
    let next = 0;
    return this.people().map((person) =>
      Object.values(person.picks).some((quantity) => quantity > 0) ? byPerson[next++] : null,
    );
  });

  public ngOnInit(): void {
    const start = this.initial();
    this.people.set(
      start.length > 0
        ? start.map((selection) => ({ ...selection.person, picks: { ...selection.picks } }))
        : [this.blankPerson(true)],
    );
  }

  protected setType(index: number, type: SeniorPwdTypeEnum): void {
    this.updatePerson(index, { type });
  }

  protected setIdNumber(index: number, value: string): void {
    this.updatePerson(index, { idNumber: value.slice(0, SENIOR_PWD_ID_MAX_LENGTH) });
    this.clearWarning(index);
  }

  protected setName(index: number, value: string): void {
    this.updatePerson(index, { customerName: value.slice(0, SENIOR_PWD_NAME_MAX_LENGTH) });
  }

  protected checkId(index: number): void {
    const idNumber = this.people()[index]?.idNumber.trim() ?? '';
    if (!idNumber || this.idError(index)) {
      return;
    }

    const duplicate = this.people().some(
      (other, otherIndex) =>
        otherIndex !== index && other.idNumber.trim().toLowerCase() === idNumber.toLowerCase(),
    );
    if (duplicate) {
      this.setWarning(index, 'This ID is already on this order for another person.');
      return;
    }

    if (!this.connectivity.isOnline()) {
      return;
    }

    this.orderService.checkSeniorPwdId(idNumber).subscribe({
      next: (check) => {
        if (check.usedToday && this.people()[index]?.idNumber.trim() === idNumber) {
          this.setWarning(
            index,
            check.lastOrderNumber
              ? `This ID was already used today on order #${check.lastOrderNumber}.`
              : 'This ID was already used on another order today.',
          );
        }
      },
      error: () => undefined,
    });
  }

  protected quantityOf(index: number, lineIndex: number): number {
    return this.people()[index]?.picks[lineIndex] ?? 0;
  }

  protected maxFor(index: number, lineIndex: number): number {
    const line = this.options()[lineIndex].line;
    return line.qty - coveredQuantityOf(this.selections(), lineIndex, index);
  }

  protected changeQuantity(index: number, lineIndex: number, delta: number): void {
    const next = Math.min(
      this.maxFor(index, lineIndex),
      Math.max(0, this.quantityOf(index, lineIndex) + delta),
    );
    this.updatePerson(index, { picks: { ...this.people()[index].picks, [lineIndex]: next } });
  }

  protected addPerson(): void {
    this.people.update((people) => [...people, this.blankPerson(false)]);
  }

  protected removePerson(index: number): void {
    this.people.update((people) => people.filter((_person, personIndex) => personIndex !== index));
    this.idWarnings.set({});
  }

  protected idError(index: number): string | null {
    const idNumber = this.people()[index]?.idNumber.trim() ?? '';
    if (!idNumber) {
      return 'Enter the ID number.';
    }

    return ID_PATTERN.test(idNumber) ? null : 'Use letters, numbers, spaces and - / . only.';
  }

  protected nameError(index: number): string | null {
    return this.people()[index]?.customerName.trim() ? null : 'Enter the name on the ID.';
  }

  protected pickError(index: number): string | null {
    const picked = Object.values(this.people()[index]?.picks ?? {}).some((quantity) => quantity > 0);
    return picked ? null : 'Choose at least one item for this person.';
  }

  protected apply(): void {
    this.showErrors.set(true);
    const invalid = this.people().some(
      (_person, index) => this.idError(index) || this.nameError(index) || this.pickError(index),
    );
    if (invalid || this.people().length === 0) {
      return;
    }

    this.applied.emit(this.selections());
  }

  private blankPerson(coverAll: boolean): PersonState {
    const picks: Record<number, number> = {};
    if (coverAll) {
      this.options().forEach((option, lineIndex) => {
        if (!option.blockedReason) {
          picks[lineIndex] = option.line.qty;
        }
      });
    }

    return { type: SeniorPwdTypeEnum.Senior, idNumber: '', customerName: '', picks };
  }

  private updatePerson(index: number, change: Partial<PersonState>): void {
    this.people.update((people) =>
      people.map((person, personIndex) => (personIndex === index ? { ...person, ...change } : person)),
    );
  }

  private setWarning(index: number, message: string): void {
    this.idWarnings.update((warnings) => ({ ...warnings, [index]: message }));
  }

  private clearWarning(index: number): void {
    this.idWarnings.update((warnings) => {
      const { [index]: _removed, ...rest } = warnings;
      return rest;
    });
  }
}
