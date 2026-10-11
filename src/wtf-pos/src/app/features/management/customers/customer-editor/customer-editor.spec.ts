import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AlertService, CustomerService } from '@core/services';
import { CustomerDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeAlert,
  fileOf,
  internals,
  Internals,
  stubRoute,
} from '../../../../testing/management-spec-helpers';
import { CustomerEditorComponent } from './customer-editor';

const CUSTOMER: CustomerDto = {
  id: 'c1',
  firstName: 'Ann',
  lastName: 'Lee',
  address: '12 Main St',
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-02-02T00:00:00Z',
  createdBy: 'x',
  imageUrl: 'http://img/a.png',
  allowOrderingLink: false,
};

const fileEvent = (file: File) => ({ target: { files: [file] } }) as unknown as Event;
const dropEvent = (file?: File) =>
  ({
    preventDefault: vi.fn(),
    dataTransfer: { files: file ? [file] : [] },
  }) as unknown as DragEvent;

describe('CustomerEditorComponent', () => {
  let fixture: ComponentFixture<CustomerEditorComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(opts: { id?: string; get?: unknown } = {}) {
    alert = fakeAlert();
    service = {
      getCustomer: vi.fn(() => opts.get ?? of(CUSTOMER)),
      createCustomer: vi.fn(() => of({ ...CUSTOMER, id: 'new1' })),
      updateCustomer: vi.fn(() => of(CUSTOMER)),
      uploadCustomerImage: vi.fn(() => of({ ...CUSTOMER, imageUrl: 'http://img/b.png' })),
      deleteCustomerImage: vi.fn(() => of({ ...CUSTOMER, imageUrl: null })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CustomerService, useValue: service },
        { provide: AlertService, useValue: alert },
        { provide: ActivatedRoute, useValue: stubRoute(opts.id ? { id: opts.id } : {}) },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(CustomerEditorComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  function fillValid() {
    c.customerForm.patchValue({ firstName: 'Zoe', lastName: 'Kim', address: '' });
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  describe('create mode', () => {
    it('starts in create mode with an invalid, empty form', () => {
      setup();
      expect(c.isEditMode()).toBe(false);
      expect(service['getCustomer']).not.toHaveBeenCalled();
      expect(c.customerForm.invalid).toBe(true);
      expect(text()).toContain('New Customer');
      expect(text()).toContain('Create Customer');
    });

    it('does not save an invalid form and marks fields touched', () => {
      setup();
      c.saveCustomer();
      expect(service['createCustomer']).not.toHaveBeenCalled();
      expect(c.customerForm.controls.firstName.touched).toBe(true);
      expect(c.hasError('firstName')).toBe(true);
      expect(c.getErrorMessage('firstName')).toBe('First name is required');
      expect(c.getErrorMessage('lastName')).toBe('Last name is required');
      expect(c.getErrorMessage('address')).toBeNull();
    });

    it('validates max lengths', () => {
      setup();
      c.customerForm.patchValue({ firstName: 'x'.repeat(101), lastName: 'y', address: 'z'.repeat(501) });
      c.customerForm.markAllAsTouched();
      expect(c.getErrorMessage('firstName')).toBe('First name cannot exceed 100 characters');
      expect(c.getErrorMessage('address')).toBe('Address cannot exceed 500 characters');
      expect(c.getErrorMessage('nonexistent')).toBeNull();
      expect(c.hasError('nonexistent')).toBe(false);
    });

    it('creates a customer (null address when empty) and navigates to details', () => {
      setup();
      fillValid();
      c.saveCustomer();
      expect(service['createCustomer']).toHaveBeenCalledWith({
        firstName: 'Zoe',
        lastName: 'Kim',
        address: null,
      });
      expect(alert.successCreated).toHaveBeenCalledWith('Customer');
      expect(router.navigateByUrl).toHaveBeenCalledWith(expect.stringContaining('new1'));
      expect(c.isSaving()).toBe(false);
    });

    it('creates then uploads the selected image', async () => {
      setup();
      fillValid();
      c.selectedFile.set(fileOf('image/png'));
      c.saveCustomer();
      expect(service['uploadCustomerImage']).toHaveBeenCalledWith('new1', expect.any(File));
      expect(alert.successUploaded).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith(expect.stringContaining('new1'));
      expect(c.selectedFile()).toBeNull();
      expect(c.currentImageUrl()).toBe('http://img/b.png');
    });

    it('alerts and re-enables on create error', () => {
      setup();
      service['createCustomer'].mockReturnValue(throwError(() => new Error('dup')));
      fillValid();
      c.saveCustomer();
      expect(alert.error).toHaveBeenCalledWith('dup');
      expect(c.isSaving()).toBe(false);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('ignores save while busy', () => {
      setup();
      fillValid();
      c.isSaving.set(true);
      c.saveCustomer();
      expect(service['createCustomer']).not.toHaveBeenCalled();
    });

    it('goBack returns to the list', () => {
      setup();
      c.goBack();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/management/customers');
    });

    it('does not call upload when no file / no id', () => {
      setup();
      c.uploadImage();
      c.uploadImageAndNavigate();
      expect(service['uploadCustomerImage']).not.toHaveBeenCalled();
      expect(c.isSaving()).toBe(false);
    });
  });

  describe('edit mode', () => {
    it('loads the customer into the form', () => {
      setup({ id: 'c1' });
      expect(c.isEditMode()).toBe(true);
      expect(service['getCustomer']).toHaveBeenCalledWith('c1');
      expect(c.customerForm.getRawValue()).toEqual({
        firstName: 'Ann',
        lastName: 'Lee',
        address: '12 Main St',
      });
      expect(c.customerFullName()).toBe('Ann Lee');
      expect(c.currentImageUrl()).toBe('http://img/a.png');
      expect(c.lastUpdatedAt()).toBe('2024-02-02T00:00:00Z');
      expect(text()).toContain('Ann Lee');
      expect(text()).toContain('Update Customer');
    });

    it('falls back to createdAt and blank address', () => {
      setup({
        id: 'c1',
        get: of({ ...CUSTOMER, updatedAt: null, address: null, imageUrl: null }),
      });
      expect(c.lastUpdatedAt()).toBe(CUSTOMER.createdAt);
      expect(c.customerForm.controls.address.value).toBe('');
      expect(c.currentImageUrl()).toBeNull();
    });

    it('alerts on load error', () => {
      setup({ id: 'c1', get: throwError(() => new Error('gone')) });
      expect(alert.error).toHaveBeenCalledWith('gone');
      expect(c.isLoading()).toBe(false);
    });

    it('shows a spinner while loading', () => {
      setup({ id: 'c1', get: new Subject<CustomerDto>() });
      expect(c.isLoading()).toBe(true);
      expect(fixture.nativeElement.querySelector('#customerForm')).toBeNull();
    });

    it('updates and navigates to details', () => {
      setup({ id: 'c1' });
      c.customerForm.patchValue({ address: '' });
      c.saveCustomer();
      expect(service['updateCustomer']).toHaveBeenCalledWith({
        id: 'c1',
        firstName: 'Ann',
        lastName: 'Lee',
        address: null,
      });
      expect(alert.successUpdated).toHaveBeenCalledWith('Customer');
      expect(router.navigateByUrl).toHaveBeenCalledWith(expect.stringContaining('c1'));
    });

    it('updates then uploads the selected image', () => {
      setup({ id: 'c1' });
      c.selectedFile.set(fileOf('image/png'));
      c.saveCustomer();
      expect(service['uploadCustomerImage']).toHaveBeenCalledWith('c1', expect.any(File));
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      expect(c.isSaving()).toBe(false);
    });

    it('keeps the form editable when the image upload fails after save', () => {
      setup({ id: 'c1' });
      service['uploadCustomerImage'].mockReturnValue(throwError(() => new Error('')));
      c.selectedFile.set(fileOf('image/png'));
      c.saveCustomer();
      expect(alert.error).toHaveBeenCalledWith('Failed to upload image.');
      expect(c.isSaving()).toBe(false);
      expect(c.isUploading()).toBe(false);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('alerts on update error', () => {
      setup({ id: 'c1' });
      service['updateCustomer'].mockReturnValue(throwError(() => new Error('conflict')));
      c.saveCustomer();
      expect(alert.error).toHaveBeenCalledWith('conflict');
      expect(c.isSaving()).toBe(false);
    });

    it('goBack returns to the details page', () => {
      setup({ id: 'c1' });
      c.goBack();
      expect(router.navigateByUrl).toHaveBeenCalledWith(expect.stringContaining('c1'));
    });

    it('uploadImage uploads and clears the selection', () => {
      setup({ id: 'c1' });
      c.selectedFile.set(fileOf('image/png'));
      c.imagePreview.set('data:x');
      c.uploadImage();
      expect(alert.successUploaded).toHaveBeenCalled();
      expect(c.selectedFile()).toBeNull();
      expect(c.imagePreview()).toBeNull();
    });

    it('uploadImage reports errors', () => {
      setup({ id: 'c1' });
      service['uploadCustomerImage'].mockReturnValue(throwError(() => new Error('big')));
      c.selectedFile.set(fileOf('image/png'));
      c.uploadImage();
      expect(alert.error).toHaveBeenCalledWith('big');
      expect(c.isUploading()).toBe(false);
    });

    it('removes the current image', () => {
      setup({ id: 'c1' });
      c.removeCurrentImage();
      expect(service['deleteCustomerImage']).toHaveBeenCalledWith('c1');
      expect(c.currentImageUrl()).toBeNull();
      expect(alert.successDeleted).toHaveBeenCalledWith('Image');
      // second call is a no-op: nothing to remove
      c.removeCurrentImage();
      expect(service['deleteCustomerImage']).toHaveBeenCalledTimes(1);
    });

    it('reports remove-image errors with a fallback', () => {
      setup({ id: 'c1' });
      service['deleteCustomerImage'].mockReturnValue(throwError(() => new Error('')));
      c.removeCurrentImage();
      expect(alert.error).toHaveBeenCalledWith('Failed to delete image.');
      expect(c.isDeletingImage()).toBe(false);
    });
  });

  describe('image selection', () => {
    it('accepts a valid image and builds a preview', async () => {
      setup();
      c.onFileSelected(fileEvent(fileOf('image/png', 100)));
      expect(c.selectedFile()).not.toBeNull();
      await vi.waitFor(() => expect(c.imagePreview()).toMatch(/^data:/));
    });

    it('rejects an invalid type', () => {
      setup();
      c.onFileSelected(fileEvent(fileOf('application/pdf')));
      expect(alert.errorInvalidImageType).toHaveBeenCalled();
      expect(c.selectedFile()).toBeNull();
    });

    it('rejects files over 5MB but accepts exactly 5MB', () => {
      setup();
      c.onFileSelected(fileEvent(fileOf('image/png', 5 * 1024 * 1024 + 1)));
      expect(alert.errorFileTooLarge).toHaveBeenCalled();
      expect(c.selectedFile()).toBeNull();
      c.onFileSelected(fileEvent(fileOf('image/jpeg', 5 * 1024 * 1024)));
      expect(c.selectedFile()).not.toBeNull();
    });

    it('ignores an empty file input', () => {
      setup();
      c.onFileSelected({ target: { files: [] } } as unknown as Event);
      expect(c.selectedFile()).toBeNull();
    });

    it('removeImage clears selection and preview', () => {
      setup();
      c.selectedFile.set(fileOf('image/png'));
      c.imagePreview.set('data:x');
      c.removeImage();
      expect(c.selectedFile()).toBeNull();
      expect(c.imagePreview()).toBeNull();
    });
  });

  describe('drag and drop', () => {
    it('tracks dragging state', () => {
      setup();
      const over = dropEvent();
      c.onDragOver(over);
      expect(c.isDragging()).toBe(true);
      expect(over.preventDefault).toHaveBeenCalled();
      c.onDragLeave(dropEvent());
      expect(c.isDragging()).toBe(false);
    });

    it('accepts a dropped valid image', async () => {
      setup();
      c.isDragging.set(true);
      c.onFileDrop(dropEvent(fileOf('image/webp')));
      expect(c.isDragging()).toBe(false);
      expect(c.selectedFile()).not.toBeNull();
      await vi.waitFor(() => expect(c.imagePreview()).toMatch(/^data:/));
    });

    it('rejects invalid type, oversize and empty drops', () => {
      setup();
      c.onFileDrop(dropEvent(fileOf('text/plain')));
      expect(alert.errorInvalidImageType).toHaveBeenCalled();
      c.onFileDrop(dropEvent(fileOf('image/png', 6 * 1024 * 1024)));
      expect(alert.errorFileTooLarge).toHaveBeenCalled();
      c.onFileDrop(dropEvent());
      expect(c.selectedFile()).toBeNull();
    });
  });

  describe('unsaved changes guard', () => {
    it('allows leaving a pristine form', () => {
      setup();
      expect(fixture.componentInstance.canDeactivate()).toBe(true);
      expect(c.showDiscardModal()).toBe(false);
    });

    it('prompts when dirty and resolves true on discard', async () => {
      setup();
      c.customerForm.markAsDirty();
      const result = fixture.componentInstance.canDeactivate() as Promise<boolean>;
      fixture.detectChanges();
      expect(c.showDiscardModal()).toBe(true);
      expect(text()).toContain('Discard Changes?');
      c.confirmDiscard();
      await expect(result).resolves.toBe(true);
      expect(c.showDiscardModal()).toBe(false);
    });

    it('resolves false when the user keeps editing', async () => {
      setup();
      c.customerForm.markAsDirty();
      const result = fixture.componentInstance.canDeactivate() as Promise<boolean>;
      c.cancelDiscard();
      await expect(result).resolves.toBe(false);
      expect(c.showDiscardModal()).toBe(false);
    });

    it('does not prompt after a successful save', () => {
      setup();
      fillValid();
      c.customerForm.markAsDirty();
      c.saveCustomer();
      expect(fixture.componentInstance.canDeactivate()).toBe(true);
    });

    it('confirm/cancel without a pending prompt are harmless', () => {
      setup();
      c.confirmDiscard();
      c.cancelDiscard();
      expect(c.showDiscardModal()).toBe(false);
    });
  });
});
