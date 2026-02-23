import { Component, computed, input } from '@angular/core';

export interface BarChartPoint {
  label: string;
  value: number;
}

@Component({
  selector: 'app-bar-chart',
  template: `
    <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" class="block h-full w-full" preserveAspectRatio="xMidYMid meet">
      <!-- Grid lines -->
      @for (line of gridLines(); track line.y) {
        <line
          [attr.x1]="padding.left"
          [attr.y1]="line.y"
          [attr.x2]="width - padding.right"
          [attr.y2]="line.y"
          stroke="#e5e7eb"
          stroke-width="0.5"
          stroke-dasharray="3,3"
        />
        <text
          [attr.x]="padding.left - 6"
          [attr.y]="line.y + 3"
          text-anchor="end"
          class="fill-gray-400"
          font-size="9"
        >
          {{ line.label }}
        </text>
      }

      <!-- Bars -->
      @for (bar of bars(); track bar.label) {
        <rect
          [attr.x]="bar.x"
          [attr.y]="bar.y"
          [attr.width]="bar.width"
          [attr.height]="bar.height"
          [attr.fill]="color()"
          rx="3"
          ry="3"
          class="transition-all duration-200"
          opacity="0.85"
        >
          <title>{{ bar.label }}: ₱{{ bar.value.toFixed(2) }}</title>
        </rect>

        <!-- X-axis labels -->
        <text
          [attr.x]="bar.x + bar.width / 2"
          [attr.y]="height - 4"
          text-anchor="middle"
          class="fill-gray-500"
          font-size="8"
        >
          {{ bar.label }}
        </text>
      }
    </svg>
  `,
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
