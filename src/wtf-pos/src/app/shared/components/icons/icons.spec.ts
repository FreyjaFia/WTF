import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { IconComponent } from './icon/icon';
import { IconsSpriteComponent } from './icons-sprite/icons-sprite';

describe('IconComponent', () => {
  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(IconComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('svg') as SVGElement;
  }

  it('references the sprite symbol by name', () => {
    const svg = render({ name: 'icon-plus' });

    expect(svg.querySelector('use')!.getAttribute('xlink:href')).toBe('#icon-plus');
  });

  it('uses 24px and currentColor by default', () => {
    const svg = render({ name: 'icon-plus' });

    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('fill')).toBe('currentColor');
  });

  it('applies size, fill and class', () => {
    const svg = render({ name: 'icon-plus', size: '16', fill: 'red', class: 'h-4 w-4' });

    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('fill')).toBe('red');
    expect(svg.getAttribute('class')).toBe('h-4 w-4');
  });
});

describe('IconsSpriteComponent', () => {
  it('renders a hidden sprite with uniquely identified symbols', () => {
    const fixture = TestBed.createComponent(IconsSpriteComponent);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    const ids = Array.from(svg.querySelectorAll('symbol')).map((s) => s.id);

    expect(svg.getAttribute('style')).toContain('display: none');
    expect(ids.length).toBeGreaterThan(10);
    expect(ids).toContain('icon-plus');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('icon-'))).toBe(true);
  });
});
