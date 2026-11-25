import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { THEMES, THEME_STORAGE_KEY } from '@core/theme';
import { beforeEach, describe, expect, it } from 'vitest';
import { IconsSpriteComponent } from '../icons/icons-sprite/icons-sprite';
import { ProfileMenuComponent } from './profile-menu';

describe('ProfileMenuComponent style options', () => {
  let fixture: ComponentFixture<ProfileMenuComponent>;

  const options = (): HTMLButtonElement[] => [
    ...fixture.nativeElement.querySelectorAll('[role="radio"]'),
  ];

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IconsSpriteComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(ProfileMenuComponent);
    fixture.componentRef.setInput('userFullName', 'Alain Elemia');
    fixture.componentRef.setInput('userRoleLabel', 'Owner');
    fixture.detectChanges();
  });

  it('outlines only the selected style', () => {
    const cafe = THEMES.find((theme) => theme.id === 'cafe')!;
    localStorage.setItem(THEME_STORAGE_KEY, cafe.id);
    fixture.nativeElement.querySelector('[data-testid="menu-style-cafe"]').click();
    fixture.detectChanges();

    for (const option of options()) {
      const selected = option.getAttribute('aria-checked') === 'true';
      expect(option.classList.contains('border-brand')).toBe(selected);
      expect(option.classList.contains('border-transparent')).toBe(!selected);
    }
    expect(options().filter((o) => o.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });
});
