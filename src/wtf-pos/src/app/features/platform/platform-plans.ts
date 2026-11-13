import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertService, PlatformService } from '@core/services';
import { normalizeFeatures, toggleFeature } from '@shared/calculations/plan-features';
import { PlanDto, PlanFeatureDto } from '@shared/models/subscription.models';
import { forkJoin } from 'rxjs';
import { PlatformChipComponent } from './platform-chip';

interface FeatureGroup {
  name: string;
  features: PlanFeatureDto[];
}

@Component({
  selector: 'app-platform-plans',
  imports: [ReactiveFormsModule, CurrencyPipe, PlatformChipComponent],
  templateUrl: './platform-plans.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformPlansComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly alerts = inject(AlertService);

  protected readonly plans = signal<PlanDto[]>([]);
  protected readonly catalog = signal<PlanFeatureDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<PlanDto | null>(null);
  protected readonly selected = signal<string[]>([]);

  protected readonly groups = computed<FeatureGroup[]>(() => {
    const groups: FeatureGroup[] = [];

    for (const feature of this.catalog()) {
      const group = groups.find((g) => g.name === feature.group);

      if (group) {
        group.features.push(feature);
      } else {
        groups.push({ name: feature.group, features: [feature] });
      }
    }

    return groups;
  });

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    monthlyPrice: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    maxUsers: new FormControl<number | null>(null, { validators: [Validators.min(1)] }),
    isActive: new FormControl(true, { nonNullable: true }),
  });

  public ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    forkJoin([this.platform.getPlans(), this.platform.getPlanFeatures()]).subscribe({
      next: ([plans, catalog]) => {
        this.plans.set(plans);
        this.catalog.set(catalog);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(PlatformService.messageOf(err, 'Could not load the plans.'));
        this.loading.set(false);
      },
    });
  }

  protected featureLabels(plan: PlanDto): string[] {
    const held = normalizeFeatures(plan.features);
    return this.catalog().filter((f) => held.includes(f.key)).map((f) => f.label);
  }

  protected edit(plan: PlanDto): void {
    this.error.set(null);
    this.form.reset({
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      maxUsers: plan.maxUsers,
      isActive: plan.isActive,
    });
    this.selected.set(normalizeFeatures(plan.features));
    this.editing.set(plan);
  }

  protected isChecked(key: string): boolean {
    return this.selected().includes(key);
  }

  protected needsText(feature: PlanFeatureDto): string | null {
    const labels = feature.needs.map((need) => this.catalog().find((f) => f.key === need)?.label ?? need);
    return labels.length > 0 ? `Needs ${labels.join(' and ')}` : null;
  }

  protected toggle(feature: PlanFeatureDto, checked: boolean): void {
    this.selected.set(toggleFeature(this.selected(), feature.key, checked, this.catalog()));
  }

  protected close(): void {
    if (this.busy()) {
      return;
    }

    this.editing.set(null);
    this.error.set(null);
  }

  protected save(): void {
    const plan = this.editing();

    if (!plan || this.form.invalid || this.busy()) {
      return;
    }

    const v = this.form.getRawValue();

    this.busy.set(true);
    this.platform
      .updatePlan(plan.id, {
        name: v.name.trim(),
        monthlyPrice: Number(v.monthlyPrice),
        features: this.selected(),
        maxUsers: v.maxUsers === null || v.maxUsers === undefined || `${v.maxUsers}` === '' ? null : Number(v.maxUsers),
        isActive: v.isActive,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.editing.set(null);
          this.alerts.success('Plan saved.');
          this.load();
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.error.set(PlatformService.messageOf(err, 'That did not work. Try again.'));
        },
      });
  }
}
