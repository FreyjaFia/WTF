import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, CustomerService, ModalStackService } from '@core/services';
import { Icon, AvatarComponent } from '@shared/components';
import { CreateCustomerDto, UpdateCustomerDto } from '@shared/models';

@Component({
  selector: 'app-customer-editor',
  imports: [CommonModule, ReactiveFormsModule, Icon, AvatarComponent],
  templateUrl: './customer-editor.html',
  host: {
    class: 'block h-full',
  },
})
export class CustomerEditorComponent implements OnInit {
  private readonly customerService = inject(CustomerService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);

  protected readonly isEditMode = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly customerFullName = signal('');
  protected readonly lastUpdatedAt = signal<string | null>(null);

  // Image upload signals
  protected readonly isUploading = signal(false);
  protected readonly isDeletingImage = signal(false);
  protected readonly isDragging = signal(false);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly imagePreview = signal<string | null>(null);
  protected readonly currentImageUrl = signal<string | null>(null);

  protected readonly customerForm = new FormGroup({
    firstName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    lastName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    address: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });

  protected customerId: string | null = null;

  // Unsaved changes guard
  protected readonly showDiscardModal = signal(false);
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private skipGuard = false;
  private modalStackId: number | null = null;

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.isEditMode.set(true);
      this.customerId = id;
      this.loadCustomer(id);
    }
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        this.alertService.errorInvalidImageType();
        return;
      }
      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        this.alertService.errorFileTooLarge();
        return;
      }
      this.selectedFile.set(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        this.imagePreview.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  protected removeImage(): void {
    this.selectedFile.set(null);
    this.imagePreview.set(null);
    // Reset file input
    const fileInput = document.getElementById('customerImage') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  protected removeCurrentImage(): void {
    if (!this.customerId || !this.currentImageUrl() || this.isDeletingImage()) {
      return;
    }

    this.isDeletingImage.set(true);
    this.customerService.deleteCustomerImage(this.customerId).subscribe({
      next: (updatedCustomer) => {
        this.currentImageUrl.set(updatedCustomer.imageUrl || null);
        this.isDeletingImage.set(false);
        this.alertService.successDeleted('Image');
      },
      error: (err) => {
        this.alertService.error(err.message || this.alertService.getDeleteErrorMessage('image'));
        this.isDeletingImage.set(false);
      },
    });
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  protected onFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (!file) {
      return;
    }
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      this.alertService.errorInvalidImageType();
      return;
    }
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      this.alertService.errorFileTooLarge();
      return;
    }
    this.selectedFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      this.imagePreview.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  protected uploadImage(customerId?: string): void {
    const file = this.selectedFile();
    const id = customerId || this.customerId;
    if (!file || !id) {
      return;
    }
    this.isUploading.set(true);
    this.customerService.uploadCustomerImage(id, file).subscribe({
      next: (updatedCustomer) => {
        this.currentImageUrl.set(updatedCustomer.imageUrl || null);
        this.isUploading.set(false);
        this.selectedFile.set(null);
        this.imagePreview.set(null);
        this.alertService.successUploaded();
      },
      error: (err) => {
        this.alertService.error(err.message || this.alertService.getUploadErrorMessage('image'));
        this.isUploading.set(false);
      },
    });
  }

  private loadCustomer(id: string): void {
    this.isLoading.set(true);

    this.customerService.getCustomer(id).subscribe({
      next: (customer) => {
        this.customerForm.patchValue({
          firstName: customer.firstName,
          lastName: customer.lastName,
          address: customer.address || '',
        });
        this.customerFullName.set(`${customer.firstName} ${customer.lastName}`.trim());
        this.currentImageUrl.set(customer.imageUrl || null);
        this.lastUpdatedAt.set(customer.updatedAt || customer.createdAt);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected saveCustomer(): void {
    if (this.customerForm.invalid) {
      this.customerForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);

    const formValue = this.customerForm.getRawValue();

    if (this.isEditMode() && this.customerId) {
      const updateDto: UpdateCustomerDto = {
        id: this.customerId,
        firstName: formValue.firstName,
        lastName: formValue.lastName,
        address: formValue.address || null,
      };

      this.customerService.updateCustomer(updateDto).subscribe({
        next: () => {
          // If there's a file selected, upload it after updating the customer
          if (this.selectedFile()) {
            this.uploadImageAndNavigate();
          } else {
            this.isSaving.set(false);
            this.skipGuard = true;
            this.alertService.successUpdated('Customer');
            this.navigateToDetails(this.customerId!);
          }
        },
        error: (err) => {
          this.alertService.error(err.message);
          this.isSaving.set(false);
        },
      });
    } else {
      const createDto: CreateCustomerDto = {
        firstName: formValue.firstName,
        lastName: formValue.lastName,
        address: formValue.address || null,
      };

      this.customerService.createCustomer(createDto).subscribe({
        next: (createdCustomer) => {
          // If there's a file selected, upload it after creating the customer
          if (this.selectedFile()) {
            this.uploadImageAndNavigate(createdCustomer.id);
          } else {
            this.isSaving.set(false);
            this.skipGuard = true;
            this.alertService.successCreated('Customer');
            this.navigateToDetails(createdCustomer.id);
          }
        },
        error: (err) => {
          this.alertService.error(err.message);
          this.isSaving.set(false);
        },
      });
    }
  }

  protected uploadImageAndNavigate(customerId?: string): void {
    const file = this.selectedFile();
    const id = customerId || this.customerId;
    if (!file || !id) {
      this.isSaving.set(false);
      return;
    }
    this.isUploading.set(true);
    this.customerService.uploadCustomerImage(id, file).subscribe({
      next: (updatedCustomer) => {
        this.currentImageUrl.set(updatedCustomer.imageUrl || null);
        this.isUploading.set(false);
        this.selectedFile.set(null);
        this.imagePreview.set(null);
        this.isSaving.set(false);
        this.skipGuard = true;
        this.navigateToDetails(id);
        this.alertService.successUploaded();
      },
      error: (err) => {
        this.alertService.error(err.message || this.alertService.getUploadErrorMessage('image'));
        this.isUploading.set(false);
        this.isSaving.set(false);
      },
    });
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.customerForm.dirty) {
      return true;
    }

    this.showDiscardModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDiscard());

    return new Promise<boolean>((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected confirmDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(true);
      this.pendingDeactivateResolve = null;
    }
  }

  protected cancelDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(false);
      this.pendingDeactivateResolve = null;
    }
  }

  protected goBack(): void {
    if (this.isEditMode() && this.customerId) {
      this.router.navigate(['/management/customers/details', this.customerId]);
    } else {
      this.router.navigate(['/management/customers']);
    }
  }

  private navigateToDetails(customerId: string): void {
    this.router.navigate(['/management/customers/details', customerId]);
  }

  protected getErrorMessage(controlName: string): string | null {
    const control = this.customerForm.get(controlName);

    if (!control || !control.errors || !control.touched) {
      return null;
    }

    if (control.errors['required']) {
      return `${this.getFieldLabel(controlName)} is required`;
    }

    if (control.errors['maxlength']) {
      return `${this.getFieldLabel(controlName)} cannot exceed ${control.errors['maxlength'].requiredLength} characters`;
    }

    return null;
  }

  private getFieldLabel(controlName: string): string {
    const labels: Record<string, string> = {
      firstName: 'First name',
      lastName: 'Last name',
      address: 'Address',
    };
    return labels[controlName] || controlName;
  }

  protected hasError(controlName: string): boolean {
    const control = this.customerForm.get(controlName);
    return !!control && control.invalid && control.touched;
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}

