import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { ConnectivityService, OrderService } from '@core/services';
import { SENIOR_PWD_DISCOUNT_PERCENT, totalsByPerson } from '@shared/calculations';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { CartItemDto, SENIOR_PWD_TYPE_LABELS, SeniorPwdTypeEnum } from '@shared/models';
import { startWith } from 'rxjs';
import {
  applySelections,
  coveredQuantityOf,
  SeniorPwdSelection,
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
  idChecked: boolean;
  picks: Record<number, number>;
}

type PersonGroup = FormGroup<{
  type: FormControl<SeniorPwdTypeEnum>;
  idNumber: FormControl<string>;
  customerName: FormControl<string>;
  idChecked: FormControl<boolean>;
}>;

const idNumberValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const idNumber = String(control.value ?? '').trim();
  if (!idNumber) {
    return { message: 'Enter the ID number.' };
  }

  return ID_PATTERN.test(idNumber) ? null : { message: 'Use letters, numbers, spaces and - / . only.' };
};

const nameValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  String(control.value ?? '').trim() ? null : { message: 'Enter the name on the ID.' };

@Component({
  selector: 'app-senior-pwd-dialog',
  imports: [DecimalPipe, IconComponent, ReactiveFormsModule],
  templateUrl: './senior-pwd-dialog.html',
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeniorPwdDialogComponent implements OnInit {
  private readonly orderService = inject(OrderService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(NonNullableFormBuilder);

  public readonly options = input.required<SeniorPwdLineOption[]>();
  public readonly initial = input<SeniorPwdSelection[]>([]);
  public readonly vatRegistered = input(false);

  public readonly applied = output<SeniorPwdSelection[]>();
  public readonly cleared = output<void>();
  public readonly cancelled = output<void>();

  protected readonly SeniorPwdTypeEnum = SeniorPwdTypeEnum;
  protected readonly types = [SeniorPwdTypeEnum.Senior, SeniorPwdTypeEnum.Pwd];
  protected readonly seniorPwdPercent = SENIOR_PWD_DISCOUNT_PERCENT;
  protected readonly typeLabels = SENIOR_PWD_TYPE_LABELS;
  protected readonly idMaxLength = SENIOR_PWD_ID_MAX_LENGTH;
  protected readonly nameMaxLength = SENIOR_PWD_NAME_MAX_LENGTH;

  protected readonly personForms = new FormArray<PersonGroup>([]);
  protected readonly showErrors = signal(false);
  protected readonly idWarnings = signal<Record<number, string>>({});

  private readonly picks = signal<Record<number, number>[]>([]);
  private readonly formChanges = toSignal(this.personForms.valueChanges.pipe(startWith(null)));

  protected readonly people = computed<PersonState[]>(() => {
    this.formChanges();
    const picks = this.picks();
    return this.personForms.getRawValue().map((value, index) => ({ ...value, picks: picks[index] ?? {} }));
  });

  protected readonly hasApplied = computed(() => this.initial().length > 0);
  protected readonly hasCoverableLine = computed(() =>
    this.options().some((option) => !option.blockedReason),
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

  private readonly selections = computed<SeniorPwdSelection[]>(() =>
    this.people().map((person) => ({
      person: {
        type: person.type,
        idNumber: person.idNumber,
        customerName: person.customerName,
        ...(person.idChecked && { idChecked: true }),
      },
      picks: person.picks,
    })),
  );

  public ngOnInit(): void {
    const start = this.initial();
    if (start.length === 0) {
      this.addPersonGroup(this.blankPerson(true));
      return;
    }

    for (const selection of start) {
      this.addPersonGroup({
        ...selection.person,
        idChecked: selection.person.idChecked ?? false,
        picks: { ...selection.picks },
      });
    }
  }

  protected personGroup(index: number): PersonGroup {
    return this.personForms.at(index);
  }

  protected typeOf(index: number): SeniorPwdTypeEnum {
    return this.personForms.at(index).controls.type.value;
  }

  protected setType(index: number, type: SeniorPwdTypeEnum): void {
    this.personForms.at(index).controls.type.setValue(type);
  }

  protected checkId(index: number): void {
    const group = this.personForms.at(index);
    const idNumber = group.controls.idNumber.value.trim();
    if (!idNumber || this.idError(index)) {
      return;
    }

    const duplicate = this.personForms.controls.some(
      (other) => other !== group && other.controls.idNumber.value.trim().toLowerCase() === idNumber.toLowerCase(),
    );
    if (duplicate) {
      this.setWarning(index, 'This ID is already on this order for another person.');
      return;
    }

    if (!this.connectivity.isOnline()) {
      return;
    }

    this.orderService
      .checkSeniorPwdId(idNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (check) => {
          // The person may have been removed or the ID retyped while the check was running.
          const currentIndex = this.personForms.controls.indexOf(group);
          if (currentIndex < 0 || group.controls.idNumber.value.trim() !== idNumber) {
            return;
          }

          group.controls.idChecked.setValue(true);
          if (check.usedToday) {
            this.setWarning(
              currentIndex,
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
    return this.picks()[index]?.[lineIndex] ?? 0;
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
    this.picks.update((all) =>
      all.map((picks, personIndex) => (personIndex === index ? { ...picks, [lineIndex]: next } : picks)),
    );
  }

  protected addPerson(): void {
    this.addPersonGroup(this.blankPerson(false));
  }

  protected removePerson(index: number): void {
    this.personForms.removeAt(index);
    this.picks.update((all) => all.filter((_picks, personIndex) => personIndex !== index));
    this.idWarnings.set({});
  }

  protected idError(index: number): string | null {
    return this.personForms.at(index)?.controls.idNumber.errors?.['message'] ?? null;
  }

  protected nameError(index: number): string | null {
    return this.personForms.at(index)?.controls.customerName.errors?.['message'] ?? null;
  }

  protected pickError(index: number): string | null {
    const picked = Object.values(this.picks()[index] ?? {}).some((quantity) => quantity > 0);
    return picked ? null : 'Choose at least one item for this person.';
  }

  protected apply(): void {
    this.showErrors.set(true);
    const invalid = this.personForms.controls.some(
      (_group, index) => this.idError(index) || this.nameError(index) || this.pickError(index),
    );
    if (invalid || this.personForms.length === 0) {
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

    return { type: SeniorPwdTypeEnum.Senior, idNumber: '', customerName: '', idChecked: false, picks };
  }

  private addPersonGroup(person: PersonState): void {
    const group: PersonGroup = this.fb.group({
      type: this.fb.control(person.type),
      idNumber: this.fb.control(person.idNumber, [idNumberValidator]),
      customerName: this.fb.control(person.customerName, [nameValidator]),
      idChecked: this.fb.control(person.idChecked),
    });

    // A retyped ID has not been checked yet, and its old warning no longer applies.
    group.controls.idNumber.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      group.controls.idChecked.setValue(false);
      this.clearWarning(this.personForms.controls.indexOf(group));
    });

    this.picks.update((all) => [...all, person.picks]);
    this.personForms.push(group);
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
