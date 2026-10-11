import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DonutChartComponent, DonutSegment } from './donut-chart';

describe('DonutChartComponent', () => {
  const C = 2 * Math.PI * 45;
  let fixture: ComponentFixture<DonutChartComponent>;

  function render(segments: DonutSegment[]): HTMLElement {
    fixture = TestBed.createComponent(DonutChartComponent);
    fixture.componentRef.setInput('segments', segments);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const center = (el: HTMLElement) => el.querySelector('text')!.textContent!.trim();

  it('renders no arcs and a zero total for empty data', () => {
    const el = render([]);
    expect(el.querySelectorAll('circle').length).toBe(0);
    expect(center(el)).toBe('₱0');
  });

  it('renders no arcs when all values are zero', () => {
    const el = render([{ label: 'A', value: 0, color: 'red' }]);
    expect(el.querySelectorAll('circle').length).toBe(0);
    expect(center(el)).toBe('₱0');
  });

  it('renders one full arc without gap for a single segment', () => {
    const el = render([{ label: 'Cash', value: 200, color: '#0f0' }]);
    const circle = el.querySelector('circle')!;
    expect(circle.getAttribute('stroke')).toBe('#0f0');
    expect(circle.getAttribute('stroke-dasharray')).toBe(`${C} ${C}`);
    expect(circle.getAttribute('stroke-dashoffset')).toBe(`${-C * 0.25}`);
    expect(circle.querySelector('title')!.textContent).toBe('Cash: PHP 200.00 (100%)');
    expect(center(el)).toBe('₱200');
  });

  it('splits multiple segments proportionally with gaps and legend', () => {
    const el = render([
      { label: 'A', value: 75, color: 'red' },
      { label: 'B', value: 25, color: 'blue' },
    ]);
    const circles = el.querySelectorAll('circle');
    expect(circles.length).toBe(2);
    expect(circles[0].getAttribute('stroke-dasharray')).toBe(`${0.75 * C - 4} ${C}`);
    expect(circles[1].getAttribute('stroke-dashoffset')).toBe(`${-(C * 0.25 + 0.75 * C)}`);
    const legend = el.querySelector('.flex-wrap')!.textContent!.replace(/\s+/g, ' ');
    expect(legend).toContain('A75%');
    expect(legend).toContain('B25%');
  });

  it('formats totals of 1000 or more in k', () => {
    const el = render([
      { label: 'A', value: 1000, color: 'red' },
      { label: 'B', value: 500, color: 'blue' },
    ]);
    expect(center(el)).toBe('₱1.5k');
  });
});
