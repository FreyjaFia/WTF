import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SubscriptionService } from '@core/services';
import { describe, expect, it } from 'vitest';
import { UsersOverCapNoticeComponent } from './users-over-cap-notice';

describe('UsersOverCapNoticeComponent', () => {
  function render(max: number | null, active: number, over: number): HTMLElement {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SubscriptionService,
          useValue: { maxUsers: signal(max), activeUsers: signal(active), usersOverCap: signal(over) },
        },
      ],
    });
    const fixture = TestBed.createComponent(UsersOverCapNoticeComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('warns when more users are active than the plan allows', () => {
    const text = render(3, 5, 2).querySelector('[data-testid="users-over-cap"]')?.textContent ?? '';

    expect(text).toContain('allows 3 active users and 5 are active');
    expect(text).toContain('Deactivate 2 users');
  });

  it('uses the singular for one user', () => {
    const text = render(1, 2, 1).querySelector('[data-testid="users-over-cap"]')?.textContent ?? '';

    expect(text).toContain('allows 1 active user and 2');
    expect(text).toContain('Deactivate 1 user ');
  });

  it('shows nothing within the cap or on an unlimited plan', () => {
    expect(render(3, 3, 0).querySelector('[data-testid="users-over-cap"]')).toBeNull();
  });
});
