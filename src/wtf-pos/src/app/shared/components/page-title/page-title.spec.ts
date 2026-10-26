import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PageTitleComponent } from './page-title';

function render(text: string) {
  const fixture = TestBed.createComponent(PageTitleComponent);
  fixture.componentRef.setInput('text', text);
  fixture.detectChanges();
  const heading = (fixture.nativeElement as HTMLElement).querySelector('h1') as HTMLElement;
  return { fixture, heading };
}

describe('PageTitleComponent', () => {
  it('shows the text as a heading with the full text as its tooltip', () => {
    const { heading } = render('Iced Spanish Latte');

    expect(heading.textContent?.trim()).toBe('Iced Spanish Latte');
    expect(heading.getAttribute('title')).toBe('Iced Spanish Latte');
  });

  it('starts clamped and says so to assistive technology', () => {
    const { heading } = render('Latte');

    expect(heading.classList.contains('line-clamp-2')).toBe(true);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands when tapped and clamps again on the next tap', () => {
    const { fixture, heading } = render('Latte');

    heading.click();
    fixture.detectChanges();
    expect(heading.classList.contains('line-clamp-2')).toBe(false);
    expect(heading.getAttribute('aria-expanded')).toBe('true');

    heading.click();
    fixture.detectChanges();
    expect(heading.classList.contains('line-clamp-2')).toBe(true);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
  });

  it('only clamps below the sm breakpoint', () => {
    const { heading } = render('Latte');

    expect(heading.classList.contains('sm:line-clamp-none')).toBe(true);
  });
});
