import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, CustomerService, ModalStackService } from '@core/services';
import { AvatarComponent, BadgeComponent, IconComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { CustomerDto } from '@shared/models';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-customer-details',
  imports: [CommonModule, RouterLink, IconComponent, BadgeComponent, AvatarComponent, ConfirmDialogComponent],
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
  protected readonly routes = AppRoutes;

  protected readonly customer = signal<CustomerDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
  protected readonly showRestoreModal = signal(false);
  protected readonly isRestoring = signal(false);
  private modalStackId: number | null = null;

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

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
