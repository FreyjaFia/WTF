import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY } from '@core/theme';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.resetTestingModule();
  });

  it('starts on the default style when nothing is saved', () => {
    const service = TestBed.inject(ThemeService);

    expect(service.current().id).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('restores the saved style', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'cafe');

    const service = TestBed.inject(ThemeService);

    expect(service.current().id).toBe('cafe');
    expect(document.documentElement.getAttribute('data-theme')).toBe('cafe');
  });

  it('ignores a saved style that no longer exists', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'retired-style');

    expect(TestBed.inject(ThemeService).current().id).toBe('light');
  });

  it('applies and saves a chosen style', () => {
    const service = TestBed.inject(ThemeService);

    service.set('cafe');

    expect(service.current().id).toBe('cafe');
    expect(document.documentElement.getAttribute('data-theme')).toBe('cafe');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('cafe');
  });
});
