import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { extractHttpErrorMessage } from './http-error-message';

const err = (error: unknown) => new HttpErrorResponse({ error, status: 400 });

describe('extractHttpErrorMessage', () => {
  it('returns a trimmed plain string body', () => {
    expect(extractHttpErrorMessage(err('  Out of stock  '))).toBe('Out of stock');
  });

  it.each([null, undefined, '', '   ', 42, true])('returns null for %j', (payload) => {
    expect(extractHttpErrorMessage(err(payload))).toBeNull();
  });

  it.each([
    [{ message: 'lower' }, 'lower'],
    [{ Message: 'upper' }, 'upper'],
    [{ title: 'problem title' }, 'problem title'],
    [{ message: '  padded  ' }, 'padded'],
  ])('reads direct message fields from %j', (payload, expected) => {
    expect(extractHttpErrorMessage(err(payload))).toBe(expected);
  });

  it('prefers message over Message over title', () => {
    expect(extractHttpErrorMessage(err({ message: 'a', Message: 'b', title: 'c' }))).toBe('a');
  });

  it('uses the first validation error from arrays', () => {
    const payload = { errors: { Name: ['', 'Name is required'], Other: ['x'] } };

    expect(extractHttpErrorMessage(err(payload))).toBe('Name is required');
  });

  it('accepts validation errors given as plain strings', () => {
    expect(extractHttpErrorMessage(err({ errors: { Name: ' Bad name ' } }))).toBe('Bad name');
  });

  it('falls through to later validation fields when earlier ones are empty', () => {
    expect(extractHttpErrorMessage(err({ errors: { A: [], B: ['second'] } }))).toBe('second');
  });

  it('prefers a direct message over validation errors', () => {
    expect(extractHttpErrorMessage(err({ title: 'Validation failed', errors: { A: ['x'] } }))).toBe(
      'Validation failed',
    );
  });

  it('returns null for objects with nothing usable', () => {
    expect(extractHttpErrorMessage(err({ message: '  ', errors: { A: [] } }))).toBeNull();
    expect(extractHttpErrorMessage(err({}))).toBeNull();
  });
});
