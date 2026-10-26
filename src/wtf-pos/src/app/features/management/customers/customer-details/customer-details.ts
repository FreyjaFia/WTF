import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  AlertService,
  AuthService,
  CustomerService,
  ModalStackService,
  OrderLinkService,
} from '@core/services';
import { environment } from '@environments/environment.development';
import { AvatarComponent, BadgeComponent, IconComponent, PageTitleComponent } from '@shared/components';
import { BadgeVariant } from '@shared/components/badge/badge';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { CustomerDto, OrderLinkDto, OrderLinkStatus } from '@shared/models';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-customer-details',
  imports: [CommonModule, RouterLink, IconComponent, BadgeComponent, AvatarComponent, ConfirmDialogComponent, PageTitleComponent],
  templateUrl: './customer-details.html',
  host: {
    class: 'block h-full',
  },
})
export class CustomerDetailsComponent implements OnInit {
  private readonly customerService = inject(CustomerService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly orderLinkService = inject(OrderLinkService);
  protected readonly routes = AppRoutes;
  protected readonly linkStatusVariants: Record<OrderLinkStatus, BadgeVariant> = {
    Active: 'success',
    Expired: 'default',
    Revoked: 'error',
  };

  protected readonly customer = signal<CustomerDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
  protected readonly showRestoreModal = signal(false);
  protected readonly isRestoring = signal(false);
  private modalStackId: number | null = null;

  protected readonly orderLinks = signal<OrderLinkDto[]>([]);
  protected readonly isLoadingLinks = signal(false);
  protected readonly isUpdatingAccess = signal(false);
  protected readonly isCreatingLink = signal(false);
  protected readonly newLinkEndDate = signal('');
  protected readonly showDisableOrderingModal = signal(false);
  protected readonly linkToRevoke = signal<OrderLinkDto | null>(null);
  protected readonly isRevokingLink = signal(false);
  protected readonly today = this.toDateInputValue(new Date());

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.loadCustomer(id);
    }
  }

  private loadCustomer(id: string): void {
    this.isLoading.set(true);

    this.customerService.getCustomer(id).subscribe({
      next: (customer) => {
        this.customer.set(customer);
        this.isLoading.set(false);
        this.orderLinks.set([]);

        if (this.showOrderLinks() && customer.allowOrderingLink) {
          this.loadOrderLinks(customer.id);
        }
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected goBack(): void {
    this.router.navigateByUrl(AppRoutes.ManagementCustomers);
  }

  protected navigateToEdit(): void {
    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }
    if (this.customer()) {
      this.router.navigateByUrl(AppRoutes.ManagementCustomerEditById(this.customer()!.id));
    }
  }

  protected restoreCustomer(): void {
    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (!this.customer()) {
      return;
    }

    this.showRestoreModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelRestore());
  }

  protected cancelRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    this.showRestoreModal.set(false);
    this.removeFromStack();
  }

  protected confirmRestore(): void {
    if (this.isRestoring()) {
      return;
    }

    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const customer = this.customer();
    if (!customer) {
      return;
    }

    this.isRestoring.set(true);
    this.customerService.restoreCustomer(customer.id).subscribe({
      next: () => {
        this.isRestoring.set(false);
        this.showRestoreModal.set(false);
        this.removeFromStack();
        this.alertService.successRestored('Customer');
        this.loadCustomer(customer.id);
      },
      error: (err) => {
        this.isRestoring.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected deleteCustomer(): void {
    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }
    if (!this.customer()) {
      return;
    }

    this.showDeleteModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDelete());
  }

  protected cancelDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    this.showDeleteModal.set(false);
    this.removeFromStack();
  }

  protected confirmDelete(): void {
    if (this.isDeleting()) {
      return;
    }

    if (!this.canWriteCustomers()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (!this.customer()) {
      return;
    }

    const customerId = this.customer()!.id;
    this.isDeleting.set(true);

    this.customerService.deleteCustomer(customerId).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.removeFromStack();
        this.alertService.successDeleted('Customer');
        this.router.navigateByUrl(AppRoutes.ManagementCustomers);
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message || this.alertService.getDeleteErrorMessage('customer'));
      },
    });
  }

  protected canWriteCustomers(): boolean {
    return this.authService.canWriteCustomers();
  }

  protected canManageOrderLinks(): boolean {
    return this.authService.canManageOrderLinks();
  }

  /** The Ordering link section is for allowed roles and active customers only. */
  protected showOrderLinks(): boolean {
    return this.canManageOrderLinks() && !!this.customer()?.isActive;
  }

  /** The address a customer opens. Native apps have no web origin, so they use the server's. */
  protected orderLinkUrl(token: string): string {
    const origin = Capacitor.isNativePlatform()
      ? environment.apiUrl.replace(/\/api\/?$/, '')
      : window.location.origin;
    return `${origin}${AppRoutes.PublicOrder(token)}`;
  }

  private loadOrderLinks(customerId: string): void {
    this.isLoadingLinks.set(true);

    this.orderLinkService.getLinks(customerId).subscribe({
      next: (links) => {
        this.orderLinks.set(links);
        this.isLoadingLinks.set(false);
      },
      error: (err) => {
        this.isLoadingLinks.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected onOrderingToggle(checked: boolean): void {
    if (this.isUpdatingAccess()) {
      return;
    }

    if (!this.canManageOrderLinks()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (checked) {
      this.updateOrderingAccess(true);
      return;
    }

    // Turning it off revokes every link, so ask first.
    this.showDisableOrderingModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDisableOrdering());
  }

  protected cancelDisableOrdering(): void {
    if (this.isUpdatingAccess()) {
      return;
    }

    this.showDisableOrderingModal.set(false);
    this.removeFromStack();
  }

  protected confirmDisableOrdering(): void {
    if (this.isUpdatingAccess()) {
      return;
    }

    this.updateOrderingAccess(false);
  }

  private updateOrderingAccess(allow: boolean): void {
    const customer = this.customer();
    if (!customer) {
      return;
    }

    this.isUpdatingAccess.set(true);
    this.orderLinkService.setAccess(customer.id, allow).subscribe({
      next: (result) => {
        this.isUpdatingAccess.set(false);
        this.showDisableOrderingModal.set(false);
        this.removeFromStack();
        this.customer.set({ ...customer, allowOrderingLink: result.allowOrderingLink });
        this.alertService.success(
          result.allowOrderingLink
            ? 'Ordering links enabled.'
            : 'Ordering links disabled. All links were revoked.',
        );
        this.loadOrderLinks(customer.id);
      },
      error: (err) => {
        this.isUpdatingAccess.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected generateLink(): void {
    const customer = this.customer();
    if (!customer || this.isCreatingLink()) {
      return;
    }

    if (!this.canManageOrderLinks()) {
      this.alertService.errorUnauthorized();
      return;
    }

    // The end date is a calendar day: the link works through the end of that day, local time.
    const endDate = this.newLinkEndDate();
    const expiresAt = endDate ? new Date(`${endDate}T23:59:59`).toISOString() : null;

    this.isCreatingLink.set(true);
    this.orderLinkService.createLink(customer.id, expiresAt).subscribe({
      next: (link) => {
        this.isCreatingLink.set(false);
        this.newLinkEndDate.set('');
        this.orderLinks.update((links) => [link, ...links]);
        this.alertService.success('Ordering link created.');
      },
      error: (err) => {
        this.isCreatingLink.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected async copyLink(link: OrderLinkDto): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.orderLinkUrl(link.token));
      this.alertService.success('Link copied.');
    } catch {
      this.alertService.error('Unable to copy the link.');
    }
  }

  protected askRevokeLink(link: OrderLinkDto): void {
    if (!this.canManageOrderLinks()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.linkToRevoke.set(link);
    this.modalStackId = this.modalStack.push(() => this.cancelRevokeLink());
  }

  protected cancelRevokeLink(): void {
    if (this.isRevokingLink()) {
      return;
    }

    this.linkToRevoke.set(null);
    this.removeFromStack();
  }

  protected confirmRevokeLink(): void {
    const customer = this.customer();
    const link = this.linkToRevoke();
    if (!customer || !link || this.isRevokingLink()) {
      return;
    }

    this.isRevokingLink.set(true);
    this.orderLinkService.revokeLink(customer.id, link.id).subscribe({
      next: () => {
        this.isRevokingLink.set(false);
        this.linkToRevoke.set(null);
        this.removeFromStack();
        this.alertService.success('Ordering link revoked.');
        this.loadOrderLinks(customer.id);
      },
      error: (err) => {
        this.isRevokingLink.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  private toDateInputValue(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
