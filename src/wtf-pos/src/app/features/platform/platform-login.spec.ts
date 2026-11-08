import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PlatformService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PlatformLoginComponent } from './platform-login';

function render(login: ReturnType<typeof vi.fn>) {
  const router = { navigateByUrl: vi.fn() };
  TestBed.configureTestingModule({
    imports: [PlatformLoginComponent],
    providers: [
      { provide: PlatformService, useValue: { login } },
      { provide: Router, useValue: router },
    ],
  });
  const fixture = TestBed.createComponent(PlatformLoginComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;

  const type = (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  return { fixture, el, router, type };
}

describe('PlatformLoginComponent', () => {
  it('keeps the button off until both fields are filled', () => {
    const { fixture, el, type } = render(vi.fn());
    const button = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    expect(button.disabled).toBe(true);
    type('platform-username', 'boss');
    type('platform-password', 'pw');
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });

  it('signs in and opens the platform page', () => {
    const login = vi.fn().mockReturnValue(of(undefined));
    const { fixture, el, router, type } = render(login);

    type('platform-username', 'boss');
    type('platform-password', 'pw');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(login).toHaveBeenCalledWith('boss', 'pw');
    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.PlatformRoot, { replaceUrl: true });
  });

  it('shows a refusal in plain words', () => {
    const login = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    const { fixture, el, router, type } = render(login);

    type('platform-username', 'boss');
    type('platform-password', 'bad');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Wrong name or password');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
