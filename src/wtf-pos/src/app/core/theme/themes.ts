/**
 * The app styles shown in the style dropdown. The colors, fonts and corner radii of each one live in
 * src/themes.css under the matching data-theme value. Add a new style there first, then list it here.
 */
export type ThemeId = 'light' | 'cafe';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  description: string;
  /** A dark style would tell the browser to draw scrollbars, date pickers and form controls dark. */
  colorScheme: 'light' | 'dark';
  /** Browser toolbar color (the theme-color meta tag). */
  metaColor: string;
  /** Page, accent and text colors, shown as the small preview dots in the dropdown. */
  swatches: [string, string, string];
}

export const DEFAULT_THEME_ID: ThemeId = 'light';

export const THEME_STORAGE_KEY = 'wtf-theme';

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'light',
    label: 'Default',
    description: 'White with green accents',
    colorScheme: 'light',
    metaColor: '#ffffff',
    swatches: ['#ffffff', '#047857', '#111827'],
  },
  {
    id: 'cafe',
    label: 'Cafe',
    description: 'Warm paper menu, terracotta accents',
    colorScheme: 'light',
    metaColor: '#f6efe2',
    swatches: ['#f6efe2', '#b4532a', '#2a1e16'],
  },
];

export function findTheme(id: string | null | undefined): ThemeDefinition | undefined {
  return THEMES.find((theme) => theme.id === id);
}
