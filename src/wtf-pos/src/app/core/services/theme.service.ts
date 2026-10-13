import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import {
  DEFAULT_THEME_ID,
  THEMES,
  THEME_STORAGE_KEY,
  findTheme,
  type ThemeDefinition,
  type ThemeId,
} from '@core/theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  public readonly themes = THEMES;
  private readonly themeId = signal<ThemeId>(this.readStoredTheme());
  private initialized = false;
  private fadeTimer: ReturnType<typeof setTimeout> | undefined;

  public readonly current = computed<ThemeDefinition>(
    () => findTheme(this.themeId()) ?? THEMES[0],
  );

  constructor() {
    this.apply(this.current());
  }

  public set(id: ThemeId): void {
    const theme = findTheme(id);

    if (!theme) {
      return;
    }

    this.themeId.set(theme.id);
    this.apply(theme);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme.id);
    } catch {
      // Storage can be blocked (private window); the style still applies for this visit.
    }
  }

  private readStoredTheme(): ThemeId {
    try {
      return findTheme(localStorage.getItem(THEME_STORAGE_KEY))?.id ?? DEFAULT_THEME_ID;
    } catch {
      return DEFAULT_THEME_ID;
    }
  }

  private apply(theme: ThemeDefinition): void {
    const root = this.document.documentElement;
    const changing = root.getAttribute('data-theme') !== theme.id;
    root.setAttribute('data-theme', theme.id);

    if (changing && this.initialized) {
      // Cross-fade colors for a moment (see theme-styles.css) instead of snapping.
      root.classList.add('theme-transition');
      clearTimeout(this.fadeTimer);
      this.fadeTimer = setTimeout(() => root.classList.remove('theme-transition'), 450);
    }

    this.initialized = true;

    this.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme.metaColor);
    this.document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute('content', `${theme.colorScheme} only`);

    if (Capacitor.isNativePlatform()) {
      // Status bar icons: dark icons on light styles, light icons on dark styles.
      StatusBar.setStyle({ style: theme.colorScheme === 'dark' ? Style.Dark : Style.Light }).catch(
        () => undefined,
      );
    }
  }
}
