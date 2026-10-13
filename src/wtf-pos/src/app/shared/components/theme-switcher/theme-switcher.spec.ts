import { ComponentFixture, TestBed } from '@angular/core/testing';
import { THEMES, THEME_STORAGE_KEY } from '@core/theme';
import { beforeEach, describe, expect, it } from 'vitest';
import { IconsSpriteComponent } from '../icons/icons-sprite/icons-sprite';
import { ThemeSwitcherComponent } from './theme-switcher';

describe('ThemeSwitcherComponent', () => {
  let fixture: ComponentFixture<ThemeSwitcherComponent>;

  const root = (): HTMLElement => fixture.nativeElement;
  const trigger = (): HTMLButtonElement => root().querySelector('button[aria-haspopup]')!;
  const options = (): HTMLButtonElement[] => [
    ...root().querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ];

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [IconsSpriteComponent] });
    fixture = TestBed.createComponent(ThemeSwitcherComponent);
    fixture.detectChanges();
  });

  it('lists every style once', () => {
    expect(options().map((option) => option.textContent)).toEqual(
      THEMES.map((theme) => expect.stringContaining(theme.label)),
    );
  });

  it('shows the current style on the button, with an accessible name', () => {
    expect(trigger().textContent).toContain('Style: Default');
    expect(trigger().getAttribute('aria-label')).toContain('Default');
  });

  it('marks only the current style as selected', () => {
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });

  it('applies and remembers the style that is picked', () => {
    options()[1].click();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('data-theme')).toBe('cafe');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('cafe');
    expect(trigger().textContent).toContain('Style: Cafe');
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('shows only the icon when compact, and keeps the name for screen readers', () => {
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();

    expect(trigger().textContent?.trim()).toBe('');
    expect(trigger().getAttribute('aria-label')).toContain('Default');
    expect(trigger().getAttribute('title')).toBe('Style: Default');
  });

  it('can draw the button outlined, and stretch when compact', () => {
    fixture.componentRef.setInput('outlined', true);
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('fullWidth', true);
    fixture.detectChanges();

    expect(trigger().classList).toContain('app-btn-secondary');
    expect(trigger().classList).not.toContain('app-btn-ghost');
    expect(trigger().classList).toContain('w-full');
  });

  it('pins the list under the app bar only when it opens downward', () => {
    const menu = (): HTMLElement => root().querySelector('ul')!;

    fixture.componentRef.setInput('placement', 'bottom-end');
    fixture.detectChanges();
    expect(menu().classList).toContain('app-theme-menu');

    fixture.componentRef.setInput('placement', 'top-center');
    fixture.detectChanges();
    expect(menu().classList).not.toContain('app-theme-menu');
  });
});
