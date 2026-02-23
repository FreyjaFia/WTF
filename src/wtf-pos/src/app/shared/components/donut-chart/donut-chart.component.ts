import { Component, computed, input } from '@angular/core';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

@Component({
  selector: 'app-donut-chart',
  template: `
    <div class="flex flex-col items-center gap-3">
      <svg viewBox="0 0 120 120" class="h-28 w-28 sm:h-32 sm:w-32">
        @for (arc of arcs(); track arc.label) {
          <circle
            cx="60"
            cy="60"
            r="45"
            fill="none"
            [attr.stroke]="arc.color"
            stroke-width="18"
            [attr.stroke-dasharray]="arc.dashArray"
            [attr.stroke-dashoffset]="arc.dashOffset"
            stroke-linecap="round"
            class="transition-all duration-500"
          >
            <title>{{ arc.label }}: ₱{{ arc.value.toFixed(2) }} ({{ arc.percent }}%)</title>
          </circle>
        }
        <!-- Center text -->
        <text
          x="60"
          y="56"
          text-anchor="middle"
          class="fill-gray-900"
          font-size="14"
          font-weight="700"
          style="font-family: 'Plus Jakarta Sans', sans-serif"
        >
          {{ totalLabel() }}
        </text>
        <text
          x="60"
          y="70"
          text-anchor="middle"
          class="fill-gray-400"
          font-size="8"
          font-weight="500"
        >
          total
        </text>
      </svg>

      <!-- Legend -->
      <div class="flex flex-wrap justify-center gap-x-4 gap-y-1">
        @for (arc of arcs(); track arc.label) {
          <div class="flex items-center gap-1.5">
            <div class="h-2.5 w-2.5 rounded-full" [style.background-color]="arc.color"></div>
            <span class="text-xs text-gray-600">{{ arc.label }}</span>
            <span class="text-xs font-semibold text-gray-900">{{ arc.percent }}%</span>
          </div>
        }
      </div>
    </div>
  `,
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
      return '₱0';
    }

    const total = data.reduce((sum, s) => sum + s.value, 0);
    return total >= 1000 ? `₱${(total / 1000).toFixed(1)}k` : `₱${total.toFixed(0)}`;
  });
}
