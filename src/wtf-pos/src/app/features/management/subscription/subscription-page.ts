import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SubscriptionService } from '@core/services';
import { BadgeComponent, BadgeVariant } from '@shared/components/badge/badge';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';
import { TenantInvoiceDto } from '@shared/models/subscription.models';

@Component({
  selector: 'app-subscription-page',
  imports: [BadgeComponent, CurrencyPipe, DatePipe, IconComponent, RouterLink],
  templateUrl: './subscription-page.html',
  standalone: true,
})
export class SubscriptionPageComponent implements OnInit {
  protected readonly shopRoute = AppRoutes.ManagementShop;

  protected readonly subscription = inject(SubscriptionService);

  protected readonly invoices = signal<TenantInvoiceDto[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly loadFailed = signal(false);

  public ngOnInit(): void {
    this.subscription.refresh();
    this.subscription.getInvoices().subscribe({
      next: (rows) => {
        this.invoices.set(rows);
        this.isLoading.set(false);
      },
      error: () => {
        this.loadFailed.set(true);
        this.isLoading.set(false);
      },
    });
  }

  protected statusVariant(): BadgeVariant {
    switch (this.subscription.warning()) {
      case 'none':
        return 'success';
      case 'soon':
      case 'lastDays':
        return 'amber';
      case 'grace':
        return 'warning';
      default:
        return 'error';
    }
  }

  protected statusLabel(): string {
    switch (this.subscription.warning()) {
      case 'none':
        return 'Active';
      case 'soon':
      case 'lastDays':
        return 'Ending soon';
      case 'grace':
        return 'Ended, grace period';
      default:
        return 'Locked';
    }
  }
}
