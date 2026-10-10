/// <reference types="node" />
// Keeps button markup on the shared button system (see "Buttons" in src/styles.css).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const appRoot = join(process.cwd(), 'src', 'app');

function templates(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      templates(path, found);
    } else if (entry.name.endsWith('.html')) {
      found.push(path);
    }
  }
  return found;
}

interface Tag {
  file: string;
  line: number;
  name: 'button' | 'a';
  text: string;
  body: string;
}

function readTags(file: string): Tag[] {
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const tags: Tag[] = [];
  const opener = /<(button|a)\b/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(source))) {
    let i = match.index;
    let quote: string | null = null;
    while (i < source.length) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      i++;
    }

    const text = source.slice(match.index, i + 1);
    const close = source.indexOf(match[1] === 'button' ? '</button>' : '</a>', i);
    tags.push({
      file: relative(appRoot, file).replace(/\\/g, '/'),
      line: source.slice(0, match.index).split('\n').length,
      name: match[1] as 'button' | 'a',
      text,
      body: close > -1 ? source.slice(i + 1, close) : '',
    });
  }

  return tags;
}

const allTags = templates(appRoot).flatMap((file) => readTags(file));
const buttons = allTags.filter((tag) => tag.name === 'button');
const where = (tag: Tag) => `${tag.file}:${tag.line}`;

describe('button conventions', () => {
  it('finds the templates', () => {
    expect(buttons.length).toBeGreaterThan(100);
  });

  it('gives every button a type (the invisible dialog backdrop button is the only exception)', () => {
    const missing = buttons
      .filter((tag) => !/\stype=|\[type\]=|\[attr\.type\]=/.test(tag.text))
      .filter((tag) => tag.body.trim() !== 'close')
      .map(where);

    expect(missing).toEqual([]);
  });

  it('does not use daisyUI btn classes on any element', () => {
    const offenders = templates(appRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      return [...source.matchAll(/(?<![\w[-])class="([^"]*)"/g)]
        .filter((match) => match[1].split(/\s+/).some((token) => token === 'btn' || token.startsWith('btn-')))
        .map((match) => `${relative(appRoot, file).replace(/\\/g, '/')}:${source.slice(0, match.index).split('\n').length}`);
    });

    expect(offenders).toEqual([]);
  });

  it('uses a button role instead of hand-built brand or danger backgrounds', () => {
    const offenders = buttons
      .filter((tag) => /class="[^"]*(bg-\[#047857\]|bg-red-600|bg-emerald-6|bg-black)/.test(tag.text))
      .filter((tag) => !/\sdata-custom-button\b/.test(tag.text))
      .filter((tag) => !/app-(btn|stepper-btn)/.test(tag.text))
      .map(where);

    expect(offenders).toEqual([]);
  });

  it('gives icon-only buttons an accessible name', () => {
    const offenders = buttons
      .filter((tag) => /<app-icon|<svg/.test(tag.body))
      .filter((tag) => tag.body.replace(/<[^>]*>/g, '').replace(/\{\{[^}]*\}\}/g, 'x').replace(/[@}{]|\s/g, '') === '')
      .filter((tag) => !/aria-label|\[attr\.aria-label\]|\stitle=|\[title\]/.test(tag.text))
      .map(where);

    expect(offenders).toEqual([]);
  });
});
