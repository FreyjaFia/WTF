import { addMoney, subtractMoney } from './money';

/**
 * The cash side of a sale, as it works at the counter: a tip is part of what the customer hands over, so the cashier
 * gives back the cash minus the total and the tip. The counterpart of `CashPayment` in the API's `WTF.Calculations`
 * project; both run the same cases from `calculation-cases.json`.
 */

/** What the customer has to pay: the order total plus any tip. */
export function amountDue(total: number, tips?: number | null): number {
  return addMoney(total, tips ?? 0);
}

/** Cash handed over minus what is due. Negative when the cash does not cover it. */
export function cashChange(received: number, total: number, tips?: number | null): number {
  return subtractMoney(received, amountDue(total, tips));
}
