import { Component, computed, input } from '@angular/core';

export interface AreaChartPoint {
  label: string;
  value: number;
}

@Component({
  selector: 'app-area-chart',
  templateUrl: './area-chart.html',
})
export class AreaChartComponent {
  public readonly data = input.required<AreaChartPoint[]>();
  public readonly color = input<string>('#047857');

  protected readonly width = 400;
  protected readonly height = 180;
  protected readonly padding = { top: 10, right: 10, bottom: 20, left: 40 };
  protected readonly gradientId = 'area-chart-gradient';

  protected readonly points = computed(() => {
    const pts = this.data();

    if (!pts || pts.length === 0) {
      return [];
    }

    const chartW = this.width - this.padding.left - this.padding.right;
    const chartH = this.height - this.padding.top - this.padding.bottom;
    const maxVal = Math.max(...pts.map((p) => p.value), 1);

    return pts.map((p, i) => ({
      x: this.padding.left + (pts.length === 1 ? chartW / 2 : (i / (pts.length - 1)) * chartW),
      y: this.padding.top + chartH - (p.value / maxVal) * chartH,
      label: p.label,
      value: p.value,
    }));
  });

  protected readonly linePath = computed(() => {
    const pts = this.points();

    if (pts.length < 2) {
      return '';
    }

    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  });

  protected readonly areaPath = computed(() => {
    const line = this.linePath();

    if (!line) {
      return '';
    }

    const pts = this.points();
    const chartBottom = this.padding.top + (this.height - this.padding.top - this.padding.bottom);
    const firstX = pts[0].x;
    const lastX = pts[pts.length - 1].x;

    return `${line} L${lastX.toFixed(1)},${chartBottom.toFixed(1)} L${firstX.toFixed(1)},${chartBottom.toFixed(1)} Z`;
  });

  protected readonly axisLabels = computed(() => {
    const pts = this.points();

    if (pts.length === 0) {
      return [];
    }

    const count = pts.length;
    let step: number;

    if (count > 60) {
      step = Math.ceil(count / 8);
    } else if (count > 30) {
      step = Math.ceil(count / 10);
    } else if (count > 12) {
      step = 3;
    } else if (count > 6) {
      step = 2;
    } else {
      step = 1;
    }

    return pts.filter((_, i) => i % step === 0 || i === count - 1);
  });

  protected readonly gridLines = computed(() => {
    const pts = this.data();
    const maxVal = Math.max(...(pts?.map((p) => p.value) ?? [0]), 1);
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
