import { Component, computed, input } from '@angular/core';

export interface BarChartPoint {
  label: string;
  value: number;
}

@Component({
  selector: 'app-bar-chart',
  templateUrl: './bar-chart.html',
})
export class BarChartComponent {
  public readonly data = input.required<BarChartPoint[]>();
  public readonly color = input<string>('#047857');

  protected readonly width = 400;
  protected readonly height = 180;
  protected readonly padding = { top: 10, right: 10, bottom: 20, left: 40 };

  protected readonly bars = computed(() => {
    const points = this.data();

    if (!points || points.length === 0) {
      return [];
    }

    const chartW = this.width - this.padding.left - this.padding.right;
    const chartH = this.height - this.padding.top - this.padding.bottom;
    const maxVal = Math.max(...points.map((p) => p.value), 1);
    const gap = 4;
    const barW = Math.max((chartW - gap * (points.length - 1)) / points.length, 2);

    return points.map((p, i) => {
      const barH = (p.value / maxVal) * chartH;
      return {
        x: this.padding.left + i * (barW + gap),
        y: this.padding.top + chartH - barH,
        width: barW,
        height: Math.max(barH, 1),
        label: p.label,
        value: p.value,
      };
    });
  });

  protected readonly gridLines = computed(() => {
    const points = this.data();
    const maxVal = Math.max(...(points?.map((p) => p.value) ?? [0]), 1);
    const chartH = this.height - this.padding.top - this.padding.bottom;
    const lineCount = 4;
    const lines: { y: number; label: string }[] = [];

    for (let i = 0; i <= lineCount; i++) {
      const val = (maxVal / lineCount) * i;
      const y = this.padding.top + chartH - (val / maxVal) * chartH;
      lines.push({ y, label: val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0) });
    }

    return lines;
  });
}
