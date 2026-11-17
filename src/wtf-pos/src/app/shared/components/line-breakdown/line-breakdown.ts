import { Component, computed, input } from '@angular/core';
import { BreakdownRowKind, formatPeso, LineBreakdown } from '@shared/calculations';

export type LineBreakdownVariant = 'card' | 'receipt';

type ShownRowKind = BreakdownRowKind | 'seniorPwd';

@Component({
  selector: 'app-line-breakdown',
  templateUrl: './line-breakdown.html',
})
export class LineBreakdownComponent {
  public readonly breakdown = input.required<LineBreakdown>();
  public readonly variant = input<LineBreakdownVariant>('card');
  public readonly seniorPwdReduction = input<number | null>(null);

  protected readonly rows = computed(() => {
    const rows: { kind: ShownRowKind; label: string; detail: string | null; amount: number }[] = [
      ...this.breakdown().rows,
    ];
    const seniorPwd = this.seniorPwdReduction();

    if (seniorPwd) {
      rows.push({ kind: 'seniorPwd', label: 'Senior/PWD discount', detail: null, amount: -seniorPwd });
    }

    return rows.map((row) => ({
      ...row,
      sign: this.signOf(row.kind, row.amount),
      text: formatPeso(row.amount),
    }));
  });

  protected readonly cardRowClass: Record<ShownRowKind, string> = {
    base: 'text-gray-500',
    addOn: 'text-gray-500',
    discount: 'font-semibold text-emerald-700',
    seniorPwd: 'font-semibold text-sky-700',
  };

  protected readonly receiptRowColor: Record<ShownRowKind, string> = {
    base: 'var(--color-gray-500)',
    addOn: 'var(--color-gray-500)',
    discount: 'var(--brand-ink)',
    seniorPwd: 'var(--color-sky-700, #0369a1)',
  };

  private signOf(kind: ShownRowKind, amount: number): string {
    if (kind === 'base') {
      return '';
    }

    return amount < 0 ? '−' : '+';
  }
}
