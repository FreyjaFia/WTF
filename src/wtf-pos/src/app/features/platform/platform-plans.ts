import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertService, PlatformService } from '@core/services';
import { PlanDto } from '@shared/models/subscription.models';
import { PlatformChipComponent } from './platform-chip';

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
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<PlanDto | null>(null);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    monthlyPrice: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    features: new FormControl('', { nonNullable: true }),
    maxUsers: new FormControl<number | null>(null, { validators: [Validators.min(1)] }),
    isActive: new FormControl(true, { nonNullable: true }),
  });

  public ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.platform.getPlans().subscribe({
      next: (plans) => {
        this.plans.set(plans);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(PlatformService.messageOf(err, 'Could not load the plans.'));
        this.loading.set(false);
      },
    });
  }

  protected edit(plan: PlanDto): void {
    this.error.set(null);
    this.form.reset({
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      features: plan.features.join('\n'),
      maxUsers: plan.maxUsers,
      isActive: plan.isActive,
    });
    this.editing.set(plan);
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
        features: v.features.split('\n').map((f) => f.trim()).filter((f) => f.length > 0),
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
