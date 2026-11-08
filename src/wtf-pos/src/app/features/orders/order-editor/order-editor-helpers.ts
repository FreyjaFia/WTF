import { isScheduleOpen } from '@shared/calculations';
import type {
  CartAddOnDto,
  CustomerDto,
  OrderItemRequestDto,
  PromotionListItemDto,
} from '@shared/models';
import { PaymentMethodEnum } from '@shared/models';

export function nameParts(
  name: string,
  term: string | null | undefined,
): { text: string; isMatch: boolean }[] {
  const trimmedTerm = term?.trim();
  if (!trimmedTerm) {
    return [{ text: name, isMatch: false }];
  }

  const lowerSource = name.toLowerCase();
  const lowerTerm = trimmedTerm.toLowerCase();
  const parts: { text: string; isMatch: boolean }[] = [];
  let index = 0;
  while (true) {
    const found = lowerSource.indexOf(lowerTerm, index);
    if (found === -1) {
      if (index < name.length) {
        parts.push({ text: name.slice(index), isMatch: false });
      }
      break;
    }

    if (found > index) {
      parts.push({ text: name.slice(index, found), isMatch: false });
    }
    parts.push({ text: name.slice(found, found + trimmedTerm.length), isMatch: true });
    index = found + trimmedTerm.length;
  }

  return parts;
}

export function isPromotionActiveInUserTimezone(
  promo: Pick<PromotionListItemDto, 'isActive' | 'startDate' | 'endDate' | 'schedule'>,
): boolean {
  if (!promo.isActive) {
    return false;
  }

  const nowLocal = new Date();
  const nowLocalDate = toLocalDateNumber(nowLocal);

  const startLocal = promo.startDate ? new Date(promo.startDate) : null;
  if (startLocal && Number.isNaN(startLocal.getTime())) {
    return false;
  }
  const startLocalDate = startLocal ? toLocalDateNumber(startLocal) : null;
  if (startLocalDate !== null && nowLocalDate < startLocalDate) {
    return false;
  }

  const endLocal = promo.endDate ? new Date(promo.endDate) : null;
  if (endLocal && Number.isNaN(endLocal.getTime())) {
    return false;
  }
  const endLocalDate = endLocal ? toLocalDateNumber(endLocal) : null;
  if (endLocalDate !== null && nowLocalDate > endLocalDate) {
    return false;
  }

  return isScheduleOpen(promo.schedule, nowLocal);
}

function toLocalDateNumber(value: Date): number {
  if (Number.isNaN(value.getTime())) {
    return -1;
  }

  return value.getFullYear() * 10000 + (value.getMonth() + 1) * 100 + value.getDate();
}

// withQuotes: an order queued offline carries the prices the customer was quoted, so the server can tell when the menu changed.
export function groupAddOns(addOns?: CartAddOnDto[], withQuotes = false): OrderItemRequestDto[] {
  if (!addOns || addOns.length === 0) {
    return [];
  }

  const grouped = new Map<string, { quantity: number; price: number }>();

  for (const ao of addOns) {
    grouped.set(ao.addOnId, {
      quantity: (grouped.get(ao.addOnId)?.quantity ?? 0) + 1,
      price: ao.price,
    });
  }

  return Array.from(grouped.entries()).map(([productId, { quantity, price }]) => ({
    productId,
    quantity,
    addOns: [],
    bundlePromotionId: null,
    ...(withQuotes && { quotedPrice: price }),
  }));
}

export function normalizeSortLabel(value: string): string {
  return value
    .replace(/^\s*\d+\s*x\s+/i, '')
    .trim()
    .toLowerCase();
}

export function customerDisplayName(customer: CustomerDto): string {
  return `${customer.firstName} ${customer.lastName}`.trim();
}

export function paymentMethodLabel(method?: PaymentMethodEnum | null): string {
  if (method === PaymentMethodEnum.Cash) {
    return 'Cash';
  }

  if (method === PaymentMethodEnum.GCash) {
    return 'GCash';
  }

  return 'N/A';
}
