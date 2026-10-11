import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@core/services';
import { describe, expect, it } from 'vitest';
import { NotFoundComponent } from './not-found';

function create(isAuthenticated: boolean) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: { isAuthenticated: () => isAuthenticated } }],
  });
  const fixture = TestBed.createComponent(NotFoundComponent);
  fixture.detectChanges();
  return fixture;
}

describe('NotFoundComponent', () => {
  it('renders the 404 message', () => {
    const el: HTMLElement = create(false).nativeElement;
    expect(el.querySelector('h1')?.textContent).toContain('404');
    expect(el.querySelector('h2')?.textContent).toContain('Page Not Found');
  });

  it('hides the home link for anonymous users', () => {
    expect((create(false).nativeElement as HTMLElement).querySelector('a')).toBeNull();
  });

  it('shows a link to the orders root when logged in', () => {
    const link = (create(true).nativeElement as HTMLElement).querySelector('a');
    expect(link?.textContent).toContain('Go to Home');
    expect(link?.getAttribute('href')).toBe('/orders');
  });
});
