import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { SubscriptionService } from '@core/services';
import { TenantInvoiceDto } from '@shared/models/subscription.models';

@Component({
  selector: 'app-subscription-page',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './subscription-page.html',
  standalone: true,
})
export class SubscriptionPageComponent implements OnInit {
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
