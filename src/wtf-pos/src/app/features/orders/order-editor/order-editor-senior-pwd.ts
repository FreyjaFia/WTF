import {
  SeniorPwdAmounts,
  fromCents,
  lineTotal,
  seniorPwdAmounts,
  seniorPwdReduction,
  sumSeniorPwdAmounts,
  toCents,
} from '@shared/calculations';
import { SENIOR_PWD_TYPE_LABELS } from '@shared/models';
import type { CartItemDto, SeniorPwdPersonRequestDto } from '@shared/models';

export interface SeniorPwdSelection {
  person: SeniorPwdPersonRequestDto;
  // How many items of each line (by position in the lines the dialog shows) this person covers.
  picks: Record<number, number>;
}

export interface SeniorPwdPersonTotals {
  covered: number;
  vatExempt: number;
  discount: number;
  amountDue: number;
}

export function isCoveredLine(line: CartItemDto): boolean {
  return line.seniorPwdPersonIndex !== null && line.seniorPwdPersonIndex !== undefined;
}

export function lineSignature(line: CartItemDto): string {
  const addOnIds = (line.addOns ?? []).map((addOn) => addOn.addOnId).sort();
  return [line.productId, addOnIds.join(','), line.specialInstructions ?? ''].join('|');
}

// The cart as it was before anyone was covered: covered lines go back into the line they were split from.
export function uncoverLines(cart: readonly CartItemDto[]): CartItemDto[] {
  const splitSignatures = new Set(cart.filter(isCoveredLine).map((line) => lineSignature(line)));
  const lines: CartItemDto[] = [];

  for (const line of cart) {
    const uncovered: CartItemDto = isCoveredLine(line) ? { ...line, seniorPwdPersonIndex: null } : line;
    const mergeable =
      !uncovered.bundleItems?.length &&
      !uncovered.bundlePromotionId &&
      splitSignatures.has(lineSignature(uncovered));
    const target = mergeable
      ? lines.findIndex(
          (candidate) =>
            !candidate.bundleItems?.length &&
            !candidate.bundlePromotionId &&
            lineSignature(candidate) === lineSignature(uncovered),
        )
      : -1;

    if (target >= 0) {
      lines[target] = { ...lines[target], qty: lines[target].qty + uncovered.qty };
    } else {
      lines.push(uncovered);
    }
  }

  return lines;
}

export function selectionsFromCart(
  cart: readonly CartItemDto[],
  persons: readonly SeniorPwdPersonRequestDto[],
): { lines: CartItemDto[]; selections: SeniorPwdSelection[] } {
  const lines = uncoverLines(cart);
  const selections: SeniorPwdSelection[] = persons.map((person) => ({ person: { ...person }, picks: {} }));

  for (const line of cart) {
    if (!isCoveredLine(line)) {
      continue;
    }

    const selection = selections[line.seniorPwdPersonIndex!];
    const lineIndex = lines.findIndex(
      (candidate) =>
        !candidate.bundleItems?.length &&
        !candidate.bundlePromotionId &&
        lineSignature(candidate) === lineSignature(line),
    );
    if (selection && lineIndex >= 0) {
      selection.picks[lineIndex] = (selection.picks[lineIndex] ?? 0) + line.qty;
    }
  }

  return { lines, selections };
}

// Splits each line into the covered part of every person and the rest. People who cover nothing are dropped.
export function applySelections(
  lines: readonly CartItemDto[],
  selections: readonly SeniorPwdSelection[],
): { cart: CartItemDto[]; persons: SeniorPwdPersonRequestDto[] } {
  const kept = selections.filter((selection) =>
    Object.values(selection.picks).some((quantity) => quantity > 0),
  );
  const cart: CartItemDto[] = [];

  lines.forEach((line, lineIndex) => {
    let remaining = line.qty;
    kept.forEach((selection, personIndex) => {
      const quantity = Math.min(remaining, Math.max(0, selection.picks[lineIndex] ?? 0));
      if (quantity > 0) {
        cart.push({ ...line, qty: quantity, seniorPwdPersonIndex: personIndex });
        remaining -= quantity;
      }
    });

    if (remaining > 0) {
      cart.push({ ...line, qty: remaining, seniorPwdPersonIndex: null });
    }
  });

  return {
    cart,
    persons: kept.map((selection) => ({
      type: selection.person.type,
      idNumber: selection.person.idNumber.trim(),
      customerName: selection.person.customerName.trim(),
    })),
  };
}

export function coveredQuantityOf(selections: readonly SeniorPwdSelection[], lineIndex: number, except = -1): number {
  return selections.reduce(
    (sum, selection, index) => (index === except ? sum : sum + (selection.picks[lineIndex] ?? 0)),
    0,
  );
}

export function rowAmounts(cart: readonly CartItemDto[], vatRegistered: boolean): (SeniorPwdAmounts | null)[] {
  return cart.map((line) =>
    isCoveredLine(line) ? seniorPwdAmounts(lineTotal(line), vatRegistered) : null,
  );
}

export function reductionOf(cart: readonly CartItemDto[], vatRegistered: boolean): number {
  let cents = 0;
  for (const amounts of rowAmounts(cart, vatRegistered)) {
    cents += amounts ? toCents(seniorPwdReduction(amounts)) : 0;
  }

  return fromCents(cents);
}

export function totalsByPerson(
  cart: readonly CartItemDto[],
  personCount: number,
  vatRegistered: boolean,
): SeniorPwdPersonTotals[] {
  const rows = rowAmounts(cart, vatRegistered);
  return Array.from({ length: personCount }, (_, personIndex) => {
    const own = rows.filter((_row, lineIndex) => cart[lineIndex].seniorPwdPersonIndex === personIndex);
    const sum = sumSeniorPwdAmounts(own.filter((row): row is SeniorPwdAmounts => row !== null));
    return {
      ...sum,
      amountDue: fromCents(toCents(sum.covered) - toCents(seniorPwdReduction(sum))),
    };
  });
}

export function personLabel(person: Pick<SeniorPwdPersonRequestDto, 'type'>): string {
  return SENIOR_PWD_TYPE_LABELS[person.type];
}
