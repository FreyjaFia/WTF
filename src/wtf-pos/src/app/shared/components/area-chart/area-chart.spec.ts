import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AreaChartComponent, AreaChartPoint } from './area-chart';

describe('AreaChartComponent', () => {
  let fixture: ComponentFixture<AreaChartComponent>;

  function render(data: AreaChartPoint[], color?: string): HTMLElement {
    fixture = TestBed.createComponent(AreaChartComponent);
    fixture.componentRef.setInput('data', data);
    if (color) {
      fixture.componentRef.setInput('color', color);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const make = (n: number): AreaChartPoint[] =>
    Array.from({ length: n }, (_, i) => ({ label: `L${i}`, value: i + 1 }));

  const xLabels = (el: HTMLElement) =>
    [...el.querySelectorAll('text')]
      .filter((t) => t.getAttribute('text-anchor') === 'middle')
      .map((t) => t.textContent!.trim());

  it('renders only grid for empty data', () => {
    const el = render([]);
    expect(el.querySelectorAll('path').length).toBe(0);
    expect(el.querySelectorAll('circle').length).toBe(0);
    expect(el.querySelectorAll('line').length).toBe(5);
    expect(xLabels(el)).toEqual([]);
  });

  it('renders a single point as a centred dot without line or area', () => {
    const el = render([{ label: 'Only', value: 10 }]);
    expect(el.querySelectorAll('path').length).toBe(0);
    const circle = el.querySelector('circle')!;
    expect(circle.getAttribute('cx')).toBe('215');
    expect(circle.getAttribute('cy')).toBe('10');
    expect(xLabels(el)).toEqual(['Only']);
  });

  it('draws line and closed area for several points', () => {
    const el = render(
      [
        { label: 'A', value: 0 },
        { label: 'B', value: 10 },
      ],
      '#abcdef',
    );
    const paths = el.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[1].getAttribute('d')).toBe('M40.0,160.0 L390.0,10.0');
    expect(paths[0].getAttribute('d')).toBe('M40.0,160.0 L390.0,10.0 L390.0,160.0 L40.0,160.0 Z');
    expect(paths[1].getAttribute('stroke')).toBe('#abcdef');
    expect(el.querySelectorAll('circle').length).toBe(2);
    expect(el.querySelector('circle title')!.textContent).toBe('A: PHP 0.00');
  });

  it('hides data point dots above 31 points', () => {
    expect(render(make(31)).querySelectorAll('circle').length).toBe(31);
    fixture.destroy();
    expect(render(make(32)).querySelectorAll('circle').length).toBe(0);
  });

  it('shows every label for up to 6 points', () => {
    expect(xLabels(render(make(6)))).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
  });

  it('shows every second label for 7 points', () => {
    expect(xLabels(render(make(7)))).toEqual(['L0', 'L2', 'L4', 'L6']);
  });

  it('shows every third label for 13 points', () => {
    expect(xLabels(render(make(13)))).toEqual(['L0', 'L3', 'L6', 'L9', 'L12']);
  });

  it('limits labels for large series but keeps the last one', () => {
    const labels = xLabels(render(make(100)));
    expect(labels.length).toBeLessThanOrEqual(14);
    expect(labels[0]).toBe('L0');
    expect(labels[labels.length - 1]).toBe('L99');
  });

  it('formats grid labels in thousands', () => {
    const el = render([{ label: 'A', value: 8000 }]);
    const labels = [...el.querySelectorAll('text')].map((t) => t.textContent!.trim());
    expect(labels).toContain('8.0k');
    expect(labels).toContain('2.0k');
  });
});
