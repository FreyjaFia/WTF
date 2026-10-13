import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_ID, THEMES, findTheme } from './themes';

const stylesDir = resolve(process.cwd(), 'src');
const read = (file: string): string => readFileSync(resolve(stylesDir, file), 'utf8');

describe('themes registry', () => {
  it('has unique ids and the default style listed first', () => {
    const ids = THEMES.map((theme) => theme.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(DEFAULT_THEME_ID);
  });

  it('finds a style by id, and nothing for an unknown id', () => {
    expect(findTheme('cafe')?.label).toBe('Cafe');
    expect(findTheme('nope')).toBeUndefined();
    expect(findTheme(null)).toBeUndefined();
  });

  it('gives every style a label, a description and three preview colors', () => {
    for (const theme of THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.swatches).toHaveLength(3);
    }
  });

  it('has CSS for every style: tokens under its data-theme value', () => {
    const css = read('themes.css') + read('theme-cafe.css');

    for (const theme of THEMES) {
      expect(css, theme.id).toContain(`[data-theme='${theme.id}']`);
    }
  });

  it('applies a saved style before the first paint for every non-default style', () => {
    const html = read('index.html');

    for (const theme of THEMES.filter((theme) => theme.id !== DEFAULT_THEME_ID)) {
      expect(html, theme.id).toContain(`'${theme.id}'`);
    }
  });
});
