import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AvatarComponent } from './avatar';

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(AvatarComponent);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AvatarComponent', () => {
  it.each([
    ['Ana Cruz', 'AC'],
    ['alain', 'A'],
    ['  Juan   Dela   Cruz ', 'JD'],
    ['123 Main', 'M'],
    ['', ''],
    ['   ', ''],
  ])('shows initials for %j -> %j', (label, initials) => {
    const el = render({ label });

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('span')!.textContent!.trim()).toBe(initials);
  });

  it('shows the image when an url is provided', () => {
    const el = render({ label: 'Ana Cruz', imageUrl: 'http://x/a.png' });

    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('http://x/a.png');
    expect(img.getAttribute('alt')).toBe('Ana Cruz');
    expect(el.querySelector('span')).toBeNull();
  });

  it('falls back to initials when the image url is empty or null', () => {
    expect(render({ label: 'Ana', imageUrl: '' }).querySelector('img')).toBeNull();
    expect(render({ label: 'Ana', imageUrl: null }).querySelector('img')).toBeNull();
  });

  it('sizes the circle and scales the font to 45%', () => {
    const el = render({ label: 'Ana', size: 100 });
    const span = el.querySelector('span')!;

    expect(span.style.width).toBe('100px');
    expect(span.style.height).toBe('100px');
    expect(span.style.fontSize).toBe('45px');
  });

  it('defaults to 40px', () => {
    const span = render({ label: 'Ana' }).querySelector('span')!;

    expect(span.style.width).toBe('40px');
    expect(span.style.fontSize).toBe('18px');
  });
});
