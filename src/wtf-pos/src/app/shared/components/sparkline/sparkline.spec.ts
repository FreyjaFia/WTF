import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SparklineComponent } from './sparkline';

describe('SparklineComponent', () => {
  let fixture: ComponentFixture<SparklineComponent>;

  function render(values: number[], extra: Record<string, unknown> = {}): HTMLElement {
    fixture = TestBed.createComponent(SparklineComponent);
    fixture.componentRef.setInput('values', values);
    Object.entries(extra).forEach(([k, v]) => fixture.componentRef.setInput(k, v));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it.each([[[]], [[5]]])('renders no paths for fewer than 2 points (%j)', (values) => {
    expect(render(values).querySelectorAll('path').length).toBe(0);
  });

  it('draws line and area for several points', () => {
    const paths = render([0, 5, 10]).querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[1].getAttribute('d')).toBe('M2.0,38.0 L100.0,20.0 L198.0,2.0');
    expect(paths[0].getAttribute('d')).toBe(
      'M2.0,38.0 L100.0,20.0 L198.0,2.0 L198.0,38.0 L2,38.0 Z',
    );
  });

  it('uses a floor of 1 for the max value', () => {
    const d = render([0, 0]).querySelectorAll('path')[1].getAttribute('d');
    expect(d).toBe('M2.0,38.0 L198.0,38.0');
  });

  it('applies color and custom gradient id', () => {
    const el = render([1, 2], { color: '#ff0000', id: 'spark-a' });
    expect(el.querySelector('linearGradient')?.getAttribute('id')).toBe('spark-a-gradient');
    expect(el.querySelectorAll('path')[0].getAttribute('fill')).toBe('url(#spark-a-gradient)');
    expect(el.querySelectorAll('path')[1].getAttribute('stroke')).toBe('#ff0000');
  });

  it('uses the default gradient id', () => {
    expect(render([1, 2]).querySelector('linearGradient')?.getAttribute('id')).toBe(
      'sparkline-gradient',
    );
  });
});
