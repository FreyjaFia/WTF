import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, CustomerService, ModalStackService } from '@core/services';
import { AvatarComponent, BadgeComponent, Icon } from '@shared/components';
import { CustomerDto } from '@shared/models';

@Component({
  selector: 'app-customer-details',
  imports: [CommonModule, RouterLink, Icon, BadgeComponent, AvatarComponent],
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

  protected readonly customer = signal<CustomerDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
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
    this.router.navigate(['/management/customers']);
  }

  protected navigateToEdit(): void {
    if (!this.canWriteManagement()) {
      this.alertService.errorUnauthorized();
      return;
    }
    if (this.customer()) {
      this.router.navigate(['/management/customers/edit', this.customer()!.id]);
    }
  }

  protected deleteCustomer(): void {
    if (!this.canWriteManagement()) {
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

    if (!this.canWriteManagement()) {
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
        this.router.navigateByUrl('/management/customers');
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message || this.alertService.getDeleteErrorMessage('customer'));
      },
    });
  }

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
