import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PlatformService } from '@core/services';
import { SearchInputComponent } from '@shared/components/search-input/search-input';
import { AppRoutes } from '@shared/constants/app-routes';
import { PlatformAuditLogDto, PlatformTenantDto } from '@shared/models/platform.models';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-platform-log',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, SearchInputComponent],
  templateUrl: './platform-log.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformLogComponent implements OnInit {
  private readonly platform = inject(PlatformService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly entries = signal<PlatformAuditLogDto[]>([]);
  protected readonly tenants = signal<PlatformTenantDto[]>([]);
  protected readonly search = new FormControl<string | null>('');
  protected readonly shopFilter = new FormControl('', { nonNullable: true });

  private readonly query = toSignal(this.search.valueChanges, { initialValue: '' });
  private readonly shopId = toSignal(this.shopFilter.valueChanges, { initialValue: '' });

  protected readonly visible = computed(() => {
    const needle = (this.query() ?? '').trim().toLowerCase();
    const shop = this.shopId();

    return this.entries().filter((e) => {
      if (shop && e.tenantId !== shop) {
        return false;
      }

      return !needle || `${e.action} ${e.username ?? ''} ${e.details ?? ''}`.toLowerCase().includes(needle);
    });
  });

  public ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin([this.platform.getAuditLogs(), this.platform.getTenants()]).subscribe({
      next: ([entries, tenants]) => {
        this.entries.set(entries);
        this.tenants.set(tenants);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(PlatformService.messageOf(err, 'Could not load the log.'));
        this.loading.set(false);
      },
    });
  }

  protected shop(tenantId: string | null): PlatformTenantDto | null {
    return this.tenants().find((t) => t.id === tenantId) ?? null;
  }

  protected shopLink(tenantId: string): string {
    return AppRoutes.PlatformShopById(tenantId);
  }
}
