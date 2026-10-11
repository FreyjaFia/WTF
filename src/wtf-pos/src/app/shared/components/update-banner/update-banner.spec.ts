import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppUpdateInfo, UpdateService } from '@core/services';
import { describe, expect, it, vi } from 'vitest';
import { UpdateBannerComponent } from './update-banner';

describe('UpdateBannerComponent', () => {
  function setup(latest: AppUpdateInfo | null, available = true) {
    const latestSig = signal<AppUpdateInfo | null>(latest);
    const fake = {
      updateAvailable: signal(available),
      latest: latestSig,
      shouldRefresh: () => latestSig()?.action === 'refresh',
      applyUpdate: vi.fn().mockResolvedValue(undefined),
      dismiss: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: UpdateService, useValue: fake }] });
    const fixture = TestBed.createComponent(UpdateBannerComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fake, fixture, el, buttons: () => el.querySelectorAll('button') };
  }

  const info = (action: 'download' | 'refresh'): AppUpdateInfo => ({
    version: '2.0.0',
    downloadUrl: null,
    releaseNotes: '',
    action,
  });

  it('renders nothing when no update is available', () => {
    const { el } = setup(info('download'), false);
    expect(el.textContent!.trim()).toBe('');
  });

  it('renders nothing when latest is missing', () => {
    const { el } = setup(null, true);
    expect(el.textContent!.trim()).toBe('');
  });

  it('shows download wording for download updates', () => {
    const { el, buttons } = setup(info('download'));
    expect(el.textContent).toContain('Update available: v2.0.0');
    expect(buttons()[0].textContent!.trim()).toBe('Download');
  });

  it('shows refresh wording for refresh updates', () => {
    const { el, buttons } = setup(info('refresh'));
    expect(el.textContent).toContain('New version available: v2.0.0. Refresh to update.');
    expect(buttons()[0].textContent!.trim()).toBe('Refresh');
  });

  it('applies the update on primary click', () => {
    const { fake, buttons } = setup(info('download'));
    buttons()[0].click();
    expect(fake.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Later click', () => {
    const { fake, buttons } = setup(info('download'));
    buttons()[1].click();
    expect(fake.dismiss).toHaveBeenCalledTimes(1);
    expect(fake.applyUpdate).not.toHaveBeenCalled();
  });
});
