import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PlatformService } from '@core/services';
import { isQuiet, needsAttention, summarizeShops } from '@shared/calculations';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';
import { PlatformAuditLogDto, PlatformTenantDto } from '@shared/models/platform.models';
import { PlanDto } from '@shared/models/subscription.models';
import { forkJoin } from 'rxjs';
import { PlatformChipComponent } from './platform-chip';
import { warningLabel, warningTone } from './platform-labels';

@Component({
  selector: 'app-platform-overview',
  imports: [DatePipe, CurrencyPipe, RouterLink, IconComponent, PlatformChipComponent],
  templateUrl: './platform-overview.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformOverviewComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);

  protected readonly shopsLink = AppRoutes.PlatformShops;
  protected readonly logLink = AppRoutes.PlatformLog;
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly tenants = signal<PlatformTenantDto[]>([]);
  protected readonly plans = signal<PlanDto[]>([]);
  protected readonly recent = signal<PlatformAuditLogDto[]>([]);

  protected readonly summary = computed(() => summarizeShops(this.tenants(), this.plans(), new Date()));
  protected readonly attention = computed(() => this.tenants().filter((t) => needsAttention(t)));
  protected readonly quiet = computed(() => this.tenants().filter((t) => isQuiet(t, new Date())));
  protected readonly warningLabel = warningLabel;
  protected readonly warningTone = warningTone;

  public ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin([this.platform.getTenants(), this.platform.getPlans(), this.platform.getAuditLogs()]).subscribe({
      next: ([tenants, plans, logs]) => {
        this.tenants.set(tenants);
        this.plans.set(plans);
        this.recent.set(logs.slice(0, 8));
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(PlatformService.messageOf(err, 'Could not load the overview.'));
        this.loading.set(false);
      },
    });
  }

  protected newShop(): void {
    this.router.navigate([AppRoutes.PlatformShops], { queryParams: { new: 1 } });
  }

  protected shopLink(tenantId: string): string {
    return AppRoutes.PlatformShopById(tenantId);
  }

  protected shopName(tenantId: string | null): string | null {
    return this.tenants().find((t) => t.id === tenantId)?.name ?? null;
  }
}
