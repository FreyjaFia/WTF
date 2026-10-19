import { Component, computed, input } from '@angular/core';
import { BreakdownRowKind, formatPeso, LineBreakdown } from '@shared/calculations';

export type LineBreakdownVariant = 'card' | 'receipt';

@Component({
  selector: 'app-line-breakdown',
  templateUrl: './line-breakdown.html',
})
export class LineBreakdownComponent {
  public readonly breakdown = input.required<LineBreakdown>();
  public readonly variant = input<LineBreakdownVariant>('card');

  protected readonly rows = computed(() =>
    this.breakdown().rows.map((row) => ({
      ...row,
      sign: this.signOf(row.kind, row.amount),
      text: formatPeso(row.amount),
    })),
  );

  protected readonly cardRowClass: Record<BreakdownRowKind, string> = {
    base: 'text-gray-500',
    addOn: 'text-gray-500',
    discount: 'font-semibold text-emerald-700',
  };

  protected readonly receiptRowColor: Record<BreakdownRowKind, string> = {
    base: 'var(--color-gray-500)',
    addOn: 'var(--color-gray-500)',
    discount: 'var(--brand-ink)',
  };

  private signOf(kind: BreakdownRowKind, amount: number): string {
    if (kind === 'base') {
      return '';
    }

    return amount < 0 ? '−' : '+';
  }
}
