import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AlertService, ConnectivityService, ModalStackService, OfflineSyncPolicyService } from '@core/services';
import { OfflineSyncPolicyDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAlert, internals, Internals } from '../../../testing/management-spec-helpers';
import { SyncPolicyPageComponent } from './sync-policy-page';

const CODES = [
  'PriceChanged',
  'AddOnPriceChanged',
  'ProductInactive',
  'BundleChanged',
  'CustomerInactive',
  'PromotionEnded',
  'UnknownProduct',
];

const DEFAULTS: OfflineSyncPolicyDto = {
  codes: CODES.map((code) => ({ code, mode: 'Hold' as const })),
  priceTolerance: 0,
  autoApproveNotes: false,
  agedAfterDays: 2,
  updatedAt: null,
};

describe('SyncPolicyPageComponent', () => {
  let fixture: ComponentFixture<SyncPolicyPageComponent>;
  let c: Internals;
  let el: HTMLElement;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let online: ReturnType<typeof signal<boolean>>;

  function setup(opts: { policy?: OfflineSyncPolicyDto; loadError?: boolean; online?: boolean } = {}) {
    alert = fakeAlert();
    online = signal(opts.online ?? true);
    service = {
      get: vi.fn(() => (opts.loadError ? throwError(() => new Error('nope')) : of(opts.policy ?? DEFAULTS))),
      save: vi.fn((body: object) => of({ ...body, updatedAt: '2026-11-13T10:00:00Z' })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OfflineSyncPolicyService, useValue: service },
        { provide: AlertService, useValue: alert },
        { provide: ConnectivityService, useValue: { isOnline: online.asReadonly() } },
        { provide: ModalStackService, useValue: { push: vi.fn(() => 1), remove: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(SyncPolicyPageComponent);
    c = internals(fixture.componentInstance);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;

  beforeEach(() => vi.restoreAllMocks());

  it('shows every code on Hold, a zero tolerance and the defaults in plain words', () => {
    setup();

    for (const code of CODES) {
      expect(q(`mode-${code}-Hold`).getAttribute('aria-checked')).toBe('true');
      expect(q(`mode-${code}-Note`).getAttribute('aria-checked')).toBe('false');
    }

    expect((q('policy-tolerance') as HTMLInputElement).value).toBe('0');
    expect((q('policy-aged-days') as HTMLInputElement).value).toBe('2');
    expect((q('policy-auto-approve') as HTMLInputElement).checked).toBe(false);
    expect(el.textContent).toContain('Default: 0.');
    expect(el.textContent).toContain('Default: 2 days');
    expect(el.textContent).toContain('Never changed: the defaults are in use.');
  });

  it('never suggests a tolerance value', () => {
    setup();
    const input = q('policy-tolerance') as HTMLInputElement;
    expect(input.placeholder).toBe('');
    expect(el.textContent).not.toMatch(/recommend|suggest|we advise/i);
  });

  it('says Senior/PWD problems always hold and has no control for them', () => {
    setup();
    expect(q('policy-fixed').textContent).toContain('always hold the sale');
    expect(el.querySelector('[data-testid*="SeniorPwd"]')).toBeNull();
    expect(el.querySelector('[data-testid*="PromotionOverLimit"]')).toBeNull();
    expect(el.querySelector('[data-testid*="StockShortfall"]')).toBeNull();
  });

  it('loads a saved policy into the form', () => {
    const policy: OfflineSyncPolicyDto = {
      codes: CODES.map((code) => ({ code, mode: code === 'CustomerInactive' ? ('Note' as const) : ('Hold' as const) })),
      priceTolerance: 5,
      autoApproveNotes: true,
      agedAfterDays: 7,
      updatedAt: '2026-11-12T10:00:00Z',
    };
    setup({ policy });

    expect(q('mode-CustomerInactive-Note').getAttribute('aria-checked')).toBe('true');
    expect((q('policy-tolerance') as HTMLInputElement).value).toBe('5');
    expect((q('policy-aged-days') as HTMLInputElement).value).toBe('7');
    expect((q('policy-auto-approve') as HTMLInputElement).checked).toBe(true);
    expect(el.textContent).toContain('Last changed');
  });

  it('starts with Save off and turns it on after a change', () => {
    setup();
    expect((q('policy-save') as HTMLButtonElement).disabled).toBe(true);

    q('mode-PriceChanged-Note').click();
    fixture.detectChanges();

    expect(q('mode-PriceChanged-Note').getAttribute('aria-checked')).toBe('true');
    expect((q('policy-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('saves the chosen modes, tolerance, auto-approve and days', () => {
    setup();
    q('mode-ProductInactive-Note').click();
    c.form.controls.priceTolerance.setValue(5);
    c.form.controls.autoApproveNotes.setValue(true);
    c.form.controls.agedAfterDays.setValue(4);
    c.form.markAsDirty();
    fixture.detectChanges();

    c.save();

    const body = service['save'].mock.calls[0][0];
    expect(body.priceTolerance).toBe(5);
    expect(body.autoApproveNotes).toBe(true);
    expect(body.agedAfterDays).toBe(4);
    expect(body.codes).toHaveLength(7);
    expect(body.codes.find((x: { code: string }) => x.code === 'ProductInactive').mode).toBe('Note');
    expect(body.codes.find((x: { code: string }) => x.code === 'PriceChanged').mode).toBe('Hold');
    expect(alert.successUpdated).toHaveBeenCalledWith('Offline sync policy');
    expect(c.form.dirty).toBe(false);
  });

  it('refuses a tolerance outside 0 to 1000 and days outside 1 to 30', () => {
    setup();
    c.form.controls.priceTolerance.setValue(1001);
    c.form.controls.agedAfterDays.setValue(31);
    c.form.markAsDirty();
    c.save();
    expect(service['save']).not.toHaveBeenCalled();

    c.form.controls.priceTolerance.setValue(-1);
    c.form.controls.agedAfterDays.setValue(0);
    expect(c.form.invalid).toBe(true);

    c.form.controls.agedAfterDays.setValue(1.5);
    expect(c.form.controls.agedAfterDays.invalid).toBe(true);
  });

  it('shows the server message when saving fails and stays editable', () => {
    setup();
    service['save'].mockReturnValueOnce(throwError(() => new Error('Only the owner can do this.')));
    c.setMode('PriceChanged', 'Note');
    c.save();

    expect(alert.error).toHaveBeenCalledWith('Only the owner can do this.');
    expect(c.isSaving()).toBe(false);
    expect(c.form.dirty).toBe(true);
  });

  it('is online only: offline it says so and cannot save', () => {
    setup({ online: false });
    expect(q('sync-policy-offline')).not.toBeNull();

    c.setMode('PriceChanged', 'Note');
    fixture.detectChanges();
    expect((q('policy-save') as HTMLButtonElement).disabled).toBe(true);

    c.save();
    expect(service['save']).not.toHaveBeenCalled();
  });

  it('offers to try again when the policy cannot be loaded', () => {
    setup({ loadError: true });
    expect(q('sync-policy-failed')).not.toBeNull();
    expect(alert.error).toHaveBeenCalledWith('nope');
  });

  it('asks before leaving with unsaved changes and lets go after Discard', async () => {
    setup();
    expect(c.canDeactivate()).toBe(true);

    c.setMode('PriceChanged', 'Note');
    const pending = c.canDeactivate() as Promise<boolean>;
    fixture.detectChanges();
    expect(c.showDiscardModal()).toBe(true);

    c.confirmDiscard();
    expect(await pending).toBe(true);

    const again = c.canDeactivate() as Promise<boolean>;
    c.cancelDiscard();
    expect(await again).toBe(false);
  });

  it('goes back to the management hub', () => {
    setup();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    q('sync-policy-back').click();
    expect(navigate).toHaveBeenCalledWith('/management');
  });
});
