import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-sparkline',
  template: `
    <svg viewBox="0 0 200 40" class="block h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient [attr.id]="gradientId()" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="color()" stop-opacity="0.25" />
          <stop offset="100%" [attr.stop-color]="color()" stop-opacity="0.02" />
        </linearGradient>
      </defs>

      @if (areaPath()) {
        <path [attr.d]="areaPath()" [attr.fill]="'url(#' + gradientId() + ')'" />
      }

      @if (linePath()) {
        <path
          [attr.d]="linePath()"
          fill="none"
          [attr.stroke]="color()"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      }
    </svg>
  `,
})
export class SparklineComponent {
  private static readonly W = 200;
  private static readonly H = 40;
  private static readonly PAD = 2;

  public readonly values = input.required<number[]>();
  public readonly color = input<string>('#047857');
  public readonly id = input<string>('sparkline');

  protected readonly gradientId = computed(() => `${this.id()}-gradient`);

  protected readonly linePath = computed(() => {
    const points = this.values();

    if (!points || points.length < 2) {
      return '';
    }

    const { W, H, PAD } = SparklineComponent;
    const maxVal = Math.max(...points, 1);
    const stepX = (W - PAD * 2) / (points.length - 1);

    return points
      .map((v, i) => {
        const x = PAD + i * stepX;
        const y = H - PAD - (v / maxVal) * (H - PAD * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  protected readonly areaPath = computed(() => {
    const line = this.linePath();

    if (!line) {
      return '';
    }

    const { W, H, PAD } = SparklineComponent;
    const points = this.values();
    const lastX = PAD + (points.length - 1) * ((W - PAD * 2) / (points.length - 1));

    return `${line} L${lastX.toFixed(1)},${(H - PAD).toFixed(1)} L${PAD},${(H - PAD).toFixed(1)} Z`;
  });
}
