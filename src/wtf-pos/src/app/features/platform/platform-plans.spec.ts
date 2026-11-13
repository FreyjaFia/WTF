import { TestBed } from '@angular/core/testing';
import { AlertService, PlatformService } from '@core/services';
import { PlanDto, PlanFeatureDto } from '@shared/models/subscription.models';
import { PlanFeatureCatalog } from '@shared/calculations/plan-features';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PlatformPlansComponent } from './platform-plans';

const catalog: PlanFeatureDto[] = PlanFeatureCatalog.map((f) => ({ ...f, needs: [...f.needs] }));

const plan = (over: Partial<PlanDto>): PlanDto => ({
  id: 2,
  code: 'pro',
  name: 'Pro',
  monthlyPrice: 2500,
  features: ['pos', 'inventory', 'promotions'],
  maxUsers: null,
  isActive: true,
  shopCount: 4,
  ...over,
});

function render(plans: PlanDto[]) {
  const platform = {
    getPlans: vi.fn().mockReturnValue(of(plans)),
    getPlanFeatures: vi.fn().mockReturnValue(of(catalog)),
    updatePlan: vi.fn().mockReturnValue(of(plans[0])),
  };
  TestBed.configureTestingModule({
    imports: [PlatformPlansComponent],
    providers: [
      { provide: PlatformService, useValue: platform },
      { provide: AlertService, useValue: { success: vi.fn(), error: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(PlatformPlansComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const tick = (key: string) => {
    el.querySelector<HTMLInputElement>(`[data-testid="feature-${key}"]`)!.click();
    fixture.detectChanges();
  };
  const box = (key: string) => el.querySelector<HTMLInputElement>(`[data-testid="feature-${key}"]`)!;
  const openEditor = () => {
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Edit plan')!.click();
    fixture.detectChanges();
  };

  return { fixture, el, platform, tick, box, openEditor };
}

describe('PlatformPlansComponent', () => {
  it('shows the shop count and the feature names of each plan, not the stored words', () => {
    const { el } = render([plan({})]);

    expect(el.querySelector('[data-testid="plan-shops-pro"]')?.textContent?.trim()).toBe('4 shops');
    const text = el.querySelector('[data-testid="plan-pro"]')!.textContent!;
    expect(text).toContain('Inventory');
    expect(text).toContain('Promotions');
    expect(text).not.toContain('pos');
  });

  it('lists every catalog feature in a checklist, ticked for what the plan holds', () => {
    const { openEditor, box } = render([plan({})]);
    openEditor();

    expect(box('inventory').checked).toBe(true);
    expect(box('promotions').checked).toBe(true);
    expect(box('purchasing').checked).toBe(false);
    expect(box('customroles')).toBeTruthy();
  });

  it('ticks what a feature needs, and unticks what needs a feature', () => {
    const { openEditor, tick, box } = render([plan({ features: [] })]);
    openEditor();

    tick('purchasing');
    expect(box('inventory').checked).toBe(true);
    expect(box('purchasing').checked).toBe(true);

    tick('inventory');
    expect(box('purchasing').checked).toBe(false);

    tick('chat');
    expect(box('orderlinks').checked).toBe(true);
  });

  it('saves the ticked keys', () => {
    const { openEditor, tick, platform, fixture, el } = render([plan({ features: [] })]);
    openEditor();
    tick('audit');

    el.querySelector('.app-dialog form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(platform.updatePlan).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ features: ['audit'] }),
    );
  });
});
