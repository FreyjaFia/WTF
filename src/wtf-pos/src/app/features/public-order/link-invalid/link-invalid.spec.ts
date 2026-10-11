import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LinkInvalidComponent } from './link-invalid';

describe('LinkInvalidComponent', () => {
  it('says the link is no longer valid without revealing why', () => {
    const fixture = TestBed.createComponent(LinkInvalidComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('This link is no longer valid');
    expect(text).toContain('ask the shop for a new link');
    expect(text).not.toMatch(/revoked only|never existed|unknown token/i);
  });

  it('offers no way into the signed-in app', () => {
    const fixture = TestBed.createComponent(LinkInvalidComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('a, button')).toBeNull();
  });
});
