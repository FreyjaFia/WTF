import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRAWER_SLIDE_MS } from './drawer-timing';
import { describe, expect, it } from 'vitest';

/**
 * Every slide-in panel must use the one shared style, so they all move at the same speed. A panel that sets its own
 * duration or easing would drift from the others.
 */
describe('slide-in panels share one timing', () => {
  const root = join(__dirname, '..', '..', '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  const panels = [
    'app/shared/components/side-drawer/side-drawer.html',
    'app/shared/components/cart-drawer/cart-drawer.html',
    'app/shared/components/order-chat-drawer/order-chat-drawer.html',
    'app/features/public-order/public-chat/public-chat.html',
  ];

  it.each(panels)('%s uses the shared panel and backdrop styles', (path) => {
    const html = read(path);

    expect(html).toContain('app-drawer-panel');
    expect(html).toContain('app-drawer-backdrop');
  });

  it.each(panels)('%s sets no timing of its own', (path) => {
    const html = read(path);

    expect(html).not.toMatch(/duration-(?!0\b)\d+/);
    expect(html).not.toMatch(/\bease-(in|out|linear)/);
    expect(html).not.toContain('transition-transform');
    expect(html).not.toContain('transition-opacity');
  });

  it('has the slide length in code equal to the one in the style sheet', () => {
    const css = read('styles.css');
    const panel = css.match(/\.app-drawer-panel\s*\{[^}]*\}/)?.[0] ?? '';

    expect(panel).toContain(`transition-duration: ${DRAWER_SLIDE_MS}ms`);
  });

  it('defines the timing once, for both the panel and its backdrop', () => {
    const css = read('styles.css');
    const panel = css.match(/\.app-drawer-panel\s*\{[^}]*\}/)?.[0] ?? '';
    const backdrop = css.match(/\.app-drawer-backdrop\s*\{[^}]*\}/)?.[0] ?? '';

    expect(panel).toContain('transition-duration: 300ms');
    expect(backdrop).toContain('transition-duration: 300ms');
    const easing = (rule: string) => rule.match(/transition-timing-function:\s*([^;]+);/)?.[1];
    expect(easing(panel)).toBeDefined();
    expect(easing(panel)).toBe(easing(backdrop));
  });
});
