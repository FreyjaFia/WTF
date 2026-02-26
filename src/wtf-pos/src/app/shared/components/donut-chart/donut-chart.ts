import { Component, computed, input } from '@angular/core';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

@Component({
  selector: 'app-donut-chart',
  templateUrl: './donut-chart.html',
})
export class DonutChartComponent {
  private static readonly CIRCUMFERENCE = 2 * Math.PI * 45; // r=45

  public readonly segments = input.required<DonutSegment[]>();

  protected readonly arcs = computed(() => {
    const data = this.segments();

    if (!data || data.length === 0) {
      return [];
    }

    const total = data.reduce((sum, s) => sum + s.value, 0);

    if (total === 0) {
      return [];
    }

    const C = DonutChartComponent.CIRCUMFERENCE;
    let offset = C * 0.25; // Start from top (12 o'clock)

    return data.map((s) => {
      const pct = (s.value / total) * 100;
      const arcLen = (s.value / total) * C;
      const gap = data.length > 1 ? 4 : 0;
      const arc = {
        label: s.label,
        value: s.value,
        color: s.color,
        percent: Math.round(pct),
        dashArray: `${Math.max(arcLen - gap, 0)} ${C}`,
        dashOffset: `${-offset}`,
      };
      offset += arcLen;
      return arc;
    });
  });

  protected readonly totalLabel = computed(() => {
    const data = this.segments();

    if (!data || data.length === 0) {
      return '\u20B10';
    }

    const total = data.reduce((sum, s) => sum + s.value, 0);
    return total >= 1000 ? `\u20B1${(total / 1000).toFixed(1)}k` : `\u20B1${total.toFixed(0)}`;
  });
}

