import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BadgeComponent, BadgeVariant } from './badge';

@Component({
  imports: [BadgeComponent],
  template: `<app-badge [variant]="variant">Paid</app-badge>`,
})
class HostComponent {
  public variant: BadgeVariant = 'info';
}

describe('BadgeComponent', () => {
  function render(variant?: BadgeVariant) {
    const fixture = TestBed.createComponent(HostComponent);
    if (variant) {
      fixture.componentInstance.variant = variant;
    }
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('span') as HTMLElement;
  }

  it('projects its content', () => {
    expect(render('success').textContent).toContain('Paid');
  });

  it.each([
    ['success', 'bg-green-50'],
    ['error', 'bg-red-50'],
    ['warning', 'bg-orange-50'],
    ['info', 'bg-blue-50'],
    ['amber', 'bg-amber-50'],
    ['default', 'bg-gray-100'],
  ] as const)('%s variant uses %s', (variant, cls) => {
    expect(render(variant).classList.contains(cls)).toBe(true);
  });
});
