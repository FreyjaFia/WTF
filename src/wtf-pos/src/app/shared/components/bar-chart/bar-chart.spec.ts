import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BarChartComponent, BarChartPoint } from './bar-chart';

describe('BarChartComponent', () => {
  let fixture: ComponentFixture<BarChartComponent>;

  function render(data: BarChartPoint[], color?: string): HTMLElement {
    fixture = TestBed.createComponent(BarChartComponent);
    fixture.componentRef.setInput('data', data);
    if (color) {
      fixture.componentRef.setInput('color', color);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const labelsOf = (el: HTMLElement) => [...el.querySelectorAll('text')].map((t) => t.textContent!.trim());

  it('renders only grid lines for empty data', () => {
    const el = render([]);
    expect(el.querySelectorAll('rect').length).toBe(0);
    expect(el.querySelectorAll('line').length).toBe(5);
    expect(labelsOf(el)).toEqual(['0', '0', '1', '1', '1']);
  });

  it('renders a single full-width bar', () => {
    const el = render([{ label: 'Mon', value: 50 }]);
    const rect = el.querySelector('rect')!;
    expect(rect.getAttribute('x')).toBe('40');
    expect(rect.getAttribute('width')).toBe('350');
    expect(rect.getAttribute('height')).toBe('150');
    expect(rect.getAttribute('y')).toBe('10');
    expect(rect.querySelector('title')!.textContent).toBe('Mon: PHP 50.00');
  });

  it('scales multiple bars relative to the max value', () => {
    const el = render([
      { label: 'A', value: 100 },
      { label: 'B', value: 50 },
    ]);
    const rects = el.querySelectorAll('rect');
    expect(rects.length).toBe(2);
    expect(rects[0].getAttribute('height')).toBe('150');
    expect(rects[1].getAttribute('height')).toBe('75');
    expect(Number(rects[1].getAttribute('x'))).toBeGreaterThan(Number(rects[0].getAttribute('x')));
  });

  it('keeps zero-value bars at minimum height 1', () => {
    const el = render([{ label: 'Z', value: 0 }]);
    expect(el.querySelector('rect')!.getAttribute('height')).toBe('1');
  });

  it('enforces a minimum bar width with many points', () => {
    const data = Array.from({ length: 200 }, (_, i) => ({ label: `d${i}`, value: i }));
    expect(render(data).querySelector('rect')!.getAttribute('width')).toBe('2');
  });

  it('formats grid labels in thousands', () => {
    const labels = labelsOf(render([{ label: 'A', value: 4000 }]));
    expect(labels).toContain('4.0k');
    expect(labels).toContain('1.0k');
    expect(labels).toContain('0');
  });

  it('applies the color and x-axis labels', () => {
    const el = render([{ label: 'Tue', value: 3 }], '#123456');
    expect(el.querySelector('rect')!.getAttribute('fill')).toBe('#123456');
    expect(labelsOf(el)).toContain('Tue');
  });
});
