import { isCoveredLine, isSeniorPwdEligibleLine } from '@shared/calculations';
import type { CartItemDto, SeniorPwdPersonRequestDto } from '@shared/models';

export interface SeniorPwdSelection {
  person: SeniorPwdPersonRequestDto;
  picks: Record<number, number>;
}

export function lineSignature(line: CartItemDto): string {
  const addOnIds = (line.addOns ?? []).map((addOn) => addOn.addOnId).sort();
  return [line.productId, addOnIds.join(','), line.specialInstructions ?? ''].join('|');
}

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
      ...(selection.person.idChecked && { idChecked: true }),
    })),
  };
}

export function coveredQuantityOf(selections: readonly SeniorPwdSelection[], lineIndex: number, except = -1): number {
  return selections.reduce(
    (sum, selection, index) => (index === except ? sum : sum + (selection.picks[lineIndex] ?? 0)),
    0,
  );
}

export function seniorPwdBlockedReasonOf(productEligible: boolean, hasPromotion: boolean, isBundle: boolean): string | null {
  if (isSeniorPwdEligibleLine(productEligible, hasPromotion, isBundle)) {
    return null;
  }

  return productEligible ? 'Promotion item, not eligible' : 'Not eligible';
}

export function dropUnusedPersons(
  cart: readonly CartItemDto[],
  persons: readonly SeniorPwdPersonRequestDto[],
): { cart: CartItemDto[]; persons: SeniorPwdPersonRequestDto[] } | null {
  const used = new Set(cart.filter(isCoveredLine).map((line) => line.seniorPwdPersonIndex!));
  const stale = persons.some((_person, index) => !used.has(index)) || [...used].some((index) => index >= persons.length);
  if (!stale) {
    return null;
  }

  const remap = new Map<number, number>();
  const kept: SeniorPwdPersonRequestDto[] = [];
  persons.forEach((person, index) => {
    if (used.has(index)) {
      remap.set(index, kept.length);
      kept.push(person);
    }
  });

  return {
    persons: kept,
    cart: cart.map((line) =>
      isCoveredLine(line) ? { ...line, seniorPwdPersonIndex: remap.get(line.seniorPwdPersonIndex!) ?? null } : line,
    ),
  };
}

export function seniorPwdCommandPart(persons: readonly SeniorPwdPersonRequestDto[]): {
  seniorPwdPersons?: SeniorPwdPersonRequestDto[];
} {
  return persons.length > 0 ? { seniorPwdPersons: [...persons] } : {};
}
