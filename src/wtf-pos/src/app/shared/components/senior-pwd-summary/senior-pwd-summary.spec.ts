import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SeniorPwdTypeEnum } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { SeniorPwdSummaryComponent } from './senior-pwd-summary';

@Component({
  imports: [SeniorPwdSummaryComponent],
  template: `<app-senior-pwd-summary
    testIdPrefix="sp"
    [type]="type"
    [customerName]="'Rosa Reyes'"
    [idNumber]="'SC-1'"
    [covered]="covered"
    [vatExempt]="vatExempt"
    [negateVatExempt]="negate"
    [discount]="20"
    [amountDue]="amountDue"
  />`,
})
class HostComponent {
  public type: SeniorPwdTypeEnum | null = SeniorPwdTypeEnum.Senior;
  public covered: number | null = 100;
  public vatExempt: number | null = 10.71;
  public negate = false;
  public amountDue: number | null = 71.43;
}

describe('SeniorPwdSummaryComponent', () => {
  function render(change: (host: HostComponent) => void = () => undefined): HTMLElement {
    const fixture = TestBed.createComponent(HostComponent);
    change(fixture.componentInstance);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: HTMLElement, id: string): string | undefined =>
    el.querySelector(`[data-testid="sp-${id}"]`)?.textContent?.trim();

  it('shows the person, every amount and the shared rate', () => {
    const el = render();

    expect(el.textContent).toContain('Senior: Rosa Reyes');
    expect(el.textContent).toContain('ID SC-1');
    expect(el.textContent).toContain('Senior/PWD discount (20%)');
    expect(text(el, 'covered')).toBe('100.00');
    expect(text(el, 'vat')).toBe('10.71');
    expect(text(el, 'discount')).toBe('-20.00');
    expect(text(el, 'due')).toBe('71.43');
  });

  it('leaves out the parts that are not given', () => {
    const el = render((host) => {
      host.type = null;
      host.covered = null;
      host.vatExempt = null;
      host.amountDue = null;
    });

    expect(el.textContent).not.toContain('ID SC-1');
    expect(text(el, 'covered')).toBeUndefined();
    expect(text(el, 'vat')).toBeUndefined();
    expect(text(el, 'due')).toBeUndefined();
    expect(text(el, 'discount')).toBe('-20.00');
  });

  it('can show the VAT exempt amount as a deduction', () => {
    expect(text(render((host) => (host.negate = true)), 'vat')).toBe('-10.71');
  });
});
