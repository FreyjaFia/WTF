import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConnectivityService, OrderService } from '@core/services';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SeniorPwdLineOption, SeniorPwdDialogComponent } from './senior-pwd-dialog';

describe('SeniorPwdDialogComponent', () => {
  let fixture: ComponentFixture<SeniorPwdDialogComponent>;
  let component: SeniorPwdDialogComponent;
  let checkId: ReturnType<typeof vi.fn>;

  const options: SeniorPwdLineOption[] = [
    { line: { productId: 'latte', name: 'Latte', price: 100, qty: 3 }, blockedReason: null },
    { line: { productId: 'promo', name: 'Promo', price: 50, qty: 1 }, blockedReason: 'Promotion item, not eligible' },
  ];

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byId = (id: string): HTMLElement => host().querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const type = (id: string, value: string): void => {
    const input = byId(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    checkId = vi.fn().mockReturnValue(of({ usedToday: true, lastOrderNumber: 12 }));
    TestBed.configureTestingModule({
      providers: [
        { provide: OrderService, useValue: { checkSeniorPwdId: checkId } },
        { provide: ConnectivityService, useValue: { isOnline: () => true } },
      ],
    });
    fixture = TestBed.createComponent(SeniorPwdDialogComponent);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('vatRegistered', false);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts with one person covering every eligible item and shows the blocked reason', () => {
    expect(byId('senior-pwd-qty-0-0').textContent?.trim()).toBe('3');
    expect(byId('senior-pwd-blocked-1').textContent).toContain('Promotion item, not eligible');
    expect(byId('senior-pwd-reminder').textContent).toContain('Check the ID before applying');
  });

  it('refuses to apply without an ID number and a name', () => {
    const applied = vi.fn();
    component.applied.subscribe(applied);

    byId('senior-pwd-apply').click();
    fixture.detectChanges();

    expect(applied).not.toHaveBeenCalled();
    expect(host().textContent).toContain('Enter the ID number.');
    expect(host().textContent).toContain('Enter the name on the ID.');
  });

  it('applies what was typed and picked, and previews the amounts', () => {
    const applied = vi.fn();
    component.applied.subscribe(applied);
    byId('senior-pwd-dec-0-0').click();
    byId('senior-pwd-dec-0-0').click();
    type('senior-pwd-id-0', 'SC-1234');
    type('senior-pwd-name-0', 'Rosa Reyes');

    expect(byId('senior-pwd-total-discount').textContent).toContain('20.00');
    expect(byId('senior-pwd-total-due').textContent).toContain('80.00');

    byId('senior-pwd-apply').click();

    expect(applied).toHaveBeenCalledWith([
      {
        person: { type: 1, idNumber: 'SC-1234', customerName: 'Rosa Reyes' },
        picks: { 0: 1 },
      },
    ]);
  });

  it('warns when the ID was used today', () => {
    type('senior-pwd-id-0', 'SC-1234');
    (byId('senior-pwd-id-0') as HTMLInputElement).dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(checkId).toHaveBeenCalledWith('SC-1234');
    expect(byId('senior-pwd-warning-0').textContent).toContain('order #12');
  });

  it('keeps a second person from covering more than the line holds', () => {
    byId('senior-pwd-add-person').click();
    fixture.detectChanges();

    expect((byId('senior-pwd-inc-1-0') as HTMLButtonElement).disabled).toBe(true);
  });
});
