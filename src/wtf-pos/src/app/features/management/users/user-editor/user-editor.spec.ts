import { Location } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AlertService, AuthService, UserService } from '@core/services';
import { UserDto, UserRoleEnum } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeAlert,
  fileOf,
  internals,
  Internals,
  stubRoute,
} from '../../../../testing/management-spec-helpers';
import { UserEditorComponent } from './user-editor';

const USER: UserDto = {
  id: 'u1',
  firstName: 'Ann',
  lastName: 'Lee',
  username: 'annlee',
  roleId: UserRoleEnum.Cashier,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-02-02T00:00:00Z',
  createdBy: 'x',
  imageUrl: 'http://img/a.png',
};

function tokenFor(claims: Record<string, unknown>): string {
  return `h.${btoa(JSON.stringify(claims))}.s`;
}

const fileEvent = (file: File) => ({ target: { files: [file] } }) as unknown as Event;
const dropEvent = (file?: File) =>
  ({
    preventDefault: vi.fn(),
    dataTransfer: { files: file ? [file] : [] },
  }) as unknown as DragEvent;

interface Opts {
  id?: string;
  profile?: boolean;
  superAdmin?: boolean;
  token?: string | null;
  get?: unknown;
}

describe('UserEditorComponent', () => {
  let fixture: ComponentFixture<UserEditorComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let auth: Record<string, ReturnType<typeof vi.fn>>;
  let location: { back: ReturnType<typeof vi.fn> };
  let router: Router;

  function setup(opts: Opts = {}) {
    alert = fakeAlert();
    service = {
      getUserById: vi.fn(() => opts.get ?? of(USER)),
      createUser: vi.fn(() => of({ ...USER, id: 'new1' })),
      updateUser: vi.fn(() => of(USER)),
      uploadUserImage: vi.fn(() => of({ ...USER, imageUrl: 'http://img/b.png' })),
      deleteUserImage: vi.fn(() => of({ ...USER, imageUrl: null })),
    };
    auth = {
      isSuperAdmin: vi.fn(() => opts.superAdmin ?? false),
      getToken: vi.fn(() => (opts.token === undefined ? tokenFor({ sub: 'me1' }) : opts.token)),
      getCurrentRoleLabel: vi.fn(() => 'Cashier'),
      updateMe: vi.fn(() => of(void 0)),
      uploadMeImage: vi.fn(() => of({ imageUrl: 'http://img/me.png' })),
      notifyMeUpdated: vi.fn(),
    };
    location = { back: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: UserService, useValue: service },
        { provide: AlertService, useValue: alert },
        { provide: AuthService, useValue: auth },
        { provide: Location, useValue: location },
        {
          provide: ActivatedRoute,
          useValue: stubRoute(opts.id ? { id: opts.id } : {}, { isProfile: opts.profile === true }),
        },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(UserEditorComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  function fillValid(extra: Record<string, unknown> = {}) {
    c.userForm.patchValue({
      firstName: 'Zoe',
      lastName: 'Kim',
      username: 'zoe',
      roleId: UserRoleEnum.Admin,
      password: 'secret1',
      confirmPassword: 'secret1',
      ...extra,
    });
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  describe('create mode', () => {
    it('starts empty and invalid', () => {
      setup();
      expect(c.isEditMode()).toBe(false);
      expect(c.isProfileMode()).toBe(false);
      expect(service['getUserById']).not.toHaveBeenCalled();
      expect(c.userForm.invalid).toBe(true);
      expect(text()).toContain('Create User');
    });

    it('hides the Super Admin role from non super admins', () => {
      setup();
      expect(c.userRoleOptions.map((r: { value: number }) => r.value)).not.toContain(
        UserRoleEnum.SuperAdmin,
      );
      expect(c.userRoleOptions.length).toBe(5);
    });

    it('offers the Super Admin role to super admins', () => {
      setup({ superAdmin: true });
      expect(c.userRoleOptions.length).toBe(6);
    });

    it('requires password and role, and reports field errors', () => {
      setup();
      c.saveUser();
      expect(service['createUser']).not.toHaveBeenCalled();
      expect(c.getErrorMessage('firstName')).toBe('This field is required.');
      expect(c.getErrorMessage('username')).toBe('This field is required.');
      expect(c.getErrorMessage('roleId')).toBe('This field is required.');
      expect(c.getErrorMessage('password')).toBe('This field is required.');
      expect(c.getErrorMessage('confirmPassword')).toBe('This field is required.');
    });

    it('validates max length', () => {
      setup();
      c.userForm.patchValue({ firstName: 'x'.repeat(101) });
      c.userForm.controls.firstName.markAsTouched();
      expect(c.getErrorMessage('firstName')).toBe('Maximum length is 100.');
    });

    it('detects password mismatch', () => {
      setup();
      fillValid({ confirmPassword: 'different' });
      c.userForm.markAllAsTouched();
      expect(c.userForm.invalid).toBe(true);
      expect(c.hasError('confirmPassword')).toBe(true);
      expect(c.getErrorMessage('confirmPassword')).toBe('Passwords do not match.');
      c.saveUser();
      expect(service['createUser']).not.toHaveBeenCalled();
    });

    it('has no error message for untouched, pristine controls', () => {
      setup();
      expect(c.hasError('firstName')).toBe(false);
      expect(c.getErrorMessage('firstName')).toBeNull();
      expect(c.hasError('nonexistent')).toBe(false);
    });

    it('creates the user and navigates to its details', () => {
      setup();
      fillValid();
      c.saveUser();
      expect(service['createUser']).toHaveBeenCalledWith({
        firstName: 'Zoe',
        lastName: 'Kim',
        username: 'zoe',
        password: 'secret1',
        roleId: UserRoleEnum.Admin,
      });
      expect(alert.successCreated).toHaveBeenCalledWith('User');
      expect(router.navigateByUrl).toHaveBeenCalledWith(expect.stringContaining('new1'));
      expect(c.isSaving()).toBe(false);
    });

    it('creates then uploads the selected image', () => {
      setup();
      fillValid();
      c.selectedFile.set(fileOf('image/png'));
      c.saveUser();
      expect(service['uploadUserImage']).toHaveBeenCalledWith('new1', expect.any(File));
      expect(alert.successCreated).toHaveBeenCalledWith('User');
      expect(router.navigateByUrl).toHaveBeenCalledWith(expect.stringContaining('new1'));
    });

    it('reports image upload errors after creation with fallback text', () => {
      setup();
      service['uploadUserImage'].mockReturnValue(throwError(() => new Error('')));
      fillValid();
      c.selectedFile.set(fileOf('image/png'));
      c.saveUser();
      expect(alert.error).toHaveBeenCalledWith('Failed to upload image.');
      expect(c.isSaving()).toBe(false);
      expect(c.isUploading()).toBe(false);
    });

    it('alerts on create failure', () => {
      setup();
      service['createUser'].mockReturnValue(throwError(() => new Error('dup')));
      fillValid();
      c.saveUser();
      expect(alert.error).toHaveBeenCalledWith('dup');
      expect(c.isSaving()).toBe(false);
    });

    it('refuses to create a Super Admin unless super admin', () => {
      setup();
      fillValid({ roleId: UserRoleEnum.SuperAdmin });
      c.saveUser();
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(service['createUser']).not.toHaveBeenCalled();
    });

    it('allows creating a Super Admin as super admin', () => {
      setup({ superAdmin: true });
      fillValid({ roleId: UserRoleEnum.SuperAdmin });
      c.saveUser();
      expect(service['createUser']).toHaveBeenCalled();
    });

    it('ignores save while busy', () => {
      setup();
      fillValid();
      c.isUploading.set(true);
      c.saveUser();
      expect(service['createUser']).not.toHaveBeenCalled();
    });

    it('goBack returns to the list', () => {
      setup();
      c.goBack();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/management/users');
    });

    it('toggles password visibility and computes the full name', () => {
      setup();
      c.togglePasswordVisibility();
      c.toggleConfirmPasswordVisibility();
      expect(c.showPassword()).toBe(true);
      expect(c.showConfirmPassword()).toBe(true);
      c.userForm.patchValue({ firstName: 'A', lastName: 'B' });
      expect(c.userFullName()).toBe('A B');
    });
  });

  describe('edit mode', () => {
    it('loads the user into the form with optional passwords', () => {
      setup({ id: 'u1' });
      expect(c.isEditMode()).toBe(true);
      expect(service['getUserById']).toHaveBeenCalledWith('u1');
      expect(c.userForm.getRawValue()).toMatchObject({
        firstName: 'Ann',
        lastName: 'Lee',
        username: 'annlee',
        roleId: UserRoleEnum.Cashier,
      });
      expect(c.userForm.valid).toBe(true);
      expect(c.userFullNameLabel()).toBe('Ann Lee');
      expect(c.lastUpdatedAt()).toBe('2024-02-02T00:00:00Z');
      expect(text()).toContain('Update User');
    });

    it('maps unknown roles to null', () => {
      setup({ id: 'u1', get: of({ ...USER, roleId: 99, updatedAt: null }) });
      expect(c.userForm.controls.roleId.value).toBeNull();
      expect(c.lastUpdatedAt()).toBe(USER.createdAt);
    });

    it('alerts on load error', () => {
      setup({ id: 'u1', get: throwError(() => new Error('gone')) });
      expect(alert.error).toHaveBeenCalledWith('gone');
      expect(c.isLoading()).toBe(false);
    });

    it('shows a spinner while loading', () => {
      setup({ id: 'u1', get: new Subject<UserDto>() });
      expect(c.isLoading()).toBe(true);
      expect(fixture.nativeElement.querySelector('#userForm')).toBeNull();
    });

    it('bounces non super admins away from super admin accounts', () => {
      setup({ id: 'u1', get: of({ ...USER, roleId: UserRoleEnum.SuperAdmin }) });
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/management/users');
      expect(c.isLoading()).toBe(false);
    });

    it('lets super admins edit super admin accounts', () => {
      setup({ id: 'u1', superAdmin: true, get: of({ ...USER, roleId: UserRoleEnum.SuperAdmin }) });
      expect(alert.errorUnauthorized).not.toHaveBeenCalled();
      expect(c.userForm.controls.roleId.value).toBe(UserRoleEnum.SuperAdmin);
    });

    it('updates without a password (undefined) and navigates to details', () => {
      setup({ id: 'u1' });
      c.saveUser();
      expect(service['updateUser']).toHaveBeenCalledWith({
        id: 'u1',
        firstName: 'Ann',
        lastName: 'Lee',
        username: 'annlee',
        password: undefined,
        roleId: UserRoleEnum.Cashier,
      });
      expect(alert.successUpdated).toHaveBeenCalledWith('User');
      expect(router.navigateByUrl).toHaveBeenCalledWith(expect.stringContaining('u1'));
    });

    it('sends a new password when both fields match', () => {
      setup({ id: 'u1' });
      c.userForm.patchValue({ password: 'newpass', confirmPassword: 'newpass' });
      c.saveUser();
      expect(service['updateUser']).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'newpass' }),
      );
    });

    it('validates the password pair rules', () => {
      setup({ id: 'u1' });
      c.userForm.patchValue({ password: 'abc', confirmPassword: '' });
      c.userForm.markAllAsTouched();
      expect(c.userForm.errors).toEqual({ confirmPasswordRequired: true });
      expect(c.getErrorMessage('confirmPassword')).toBe('Please re-enter your password.');

      c.userForm.patchValue({ password: '', confirmPassword: 'abc' });
      expect(c.userForm.errors).toEqual({ passwordRequired: true });
      expect(c.getErrorMessage('password')).toBe(
        'Password is required when confirm password is set.',
      );

      c.userForm.patchValue({ password: 'abc', confirmPassword: 'abd' });
      expect(c.userForm.errors).toEqual({ passwordMismatch: true });

      c.userForm.patchValue({ password: '  ', confirmPassword: '' });
      expect(c.userForm.errors).toBeNull();
      c.saveUser();
      expect(service['updateUser']).toHaveBeenCalled();
    });

    it('updates then uploads the selected image', () => {
      setup({ id: 'u1' });
      c.selectedFile.set(fileOf('image/png'));
      c.saveUser();
      expect(service['uploadUserImage']).toHaveBeenCalledWith('u1', expect.any(File));
      expect(alert.successUpdated).toHaveBeenCalledWith('User');
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('alerts on update failure', () => {
      setup({ id: 'u1' });
      service['updateUser'].mockReturnValue(throwError(() => new Error('conflict')));
      c.saveUser();
      expect(alert.error).toHaveBeenCalledWith('conflict');
      expect(c.isSaving()).toBe(false);
    });

    it('refuses to promote someone to Super Admin as a non super admin', () => {
      setup({ id: 'u1' });
      c.userForm.controls.roleId.setValue(UserRoleEnum.SuperAdmin);
      c.saveUser();
      expect(alert.errorUnauthorized).toHaveBeenCalled();
      expect(service['updateUser']).not.toHaveBeenCalled();
    });

    it('goBack returns to the details page', () => {
      setup({ id: 'u1' });
      c.goBack();
      expect(router.navigateByUrl).toHaveBeenCalledWith(expect.stringContaining('u1'));
    });

    it('removes the current image', () => {
      setup({ id: 'u1' });
      c.removeCurrentImage();
      expect(service['deleteUserImage']).toHaveBeenCalledWith('u1');
      expect(c.currentImageUrl()).toBeNull();
      expect(alert.successDeleted).toHaveBeenCalledWith('Image');
      c.removeCurrentImage();
      expect(service['deleteUserImage']).toHaveBeenCalledTimes(1);
    });

    it('reports remove-image errors with fallback', () => {
      setup({ id: 'u1' });
      service['deleteUserImage'].mockReturnValue(throwError(() => new Error('')));
      c.removeCurrentImage();
      expect(alert.error).toHaveBeenCalledWith('Failed to delete image.');
      expect(c.isDeletingImage()).toBe(false);
    });

    it('uploadImage uploads and clears the selection; errors are reported', () => {
      setup({ id: 'u1' });
      c.uploadImage();
      expect(service['uploadUserImage']).not.toHaveBeenCalled();
      c.selectedFile.set(fileOf('image/png'));
      c.imagePreview.set('data:x');
      c.uploadImage();
      expect(alert.successUploaded).toHaveBeenCalled();
      expect(c.selectedFile()).toBeNull();
      expect(c.currentImageUrl()).toBe('http://img/b.png');

      service['uploadUserImage'].mockReturnValue(throwError(() => new Error('big')));
      c.selectedFile.set(fileOf('image/png'));
      c.uploadImage();
      expect(alert.error).toHaveBeenCalledWith('big');
      expect(c.isUploading()).toBe(false);
    });
  });

  describe('profile mode', () => {
    it('redirects to login without a token', () => {
      setup({ profile: true, token: null });
      expect(alert.error).toHaveBeenCalledWith('Unable to load profile. Please sign in again.');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login', { replaceUrl: true });
      expect(service['getUserById']).not.toHaveBeenCalled();
    });

    it('redirects to login with an undecodable token', () => {
      setup({ profile: true, token: 'garbage' });
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login', { replaceUrl: true });
    });

    it('redirects when the token has no usable id claim', () => {
      setup({ profile: true, token: tokenFor({ sub: 5, nameid: '  ' }) });
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login', { replaceUrl: true });
    });

    it('falls back through id claim candidates', () => {
      setup({ profile: true, token: tokenFor({ nameid: 'n1' }) });
      expect(service['getUserById']).toHaveBeenCalledWith('n1');
    });

    it('loads the current user with a disabled role and read-only identity', () => {
      setup({ profile: true });
      expect(c.isProfileMode()).toBe(true);
      expect(c.isEditMode()).toBe(true);
      expect(service['getUserById']).toHaveBeenCalledWith('me1');
      expect(c.userForm.controls.roleId.disabled).toBe(true);
      expect(c.currentUserRoleLabel).toBe('Cashier');
      expect(fixture.nativeElement.querySelector('#roleId')).toBeNull();
      expect(fixture.nativeElement.querySelector('#userImage')).not.toBeNull();
    });

    it('does not bounce non super admins on their own super admin profile', () => {
      setup({ profile: true, get: of({ ...USER, roleId: UserRoleEnum.SuperAdmin }) });
      expect(alert.errorUnauthorized).not.toHaveBeenCalled();
    });

    it('refuses to save when there is nothing to update', () => {
      setup({ profile: true });
      c.saveUser();
      expect(alert.errorNothingToUpdate).toHaveBeenCalled();
      expect(auth['updateMe']).not.toHaveBeenCalled();
    });

    it('does not save while the password pair is invalid', () => {
      setup({ profile: true });
      c.userForm.patchValue({ password: 'abc', confirmPassword: 'xyz' });
      c.saveUser();
      expect(auth['updateMe']).not.toHaveBeenCalled();
      expect(alert.errorNothingToUpdate).not.toHaveBeenCalled();
    });

    it('asks for the current password and a minimum length before changing it', () => {
      setup({ profile: true });
      c.userForm.patchValue({
        password: 'short',
        confirmPassword: 'short',
        currentPassword: 'old-pass',
      });
      expect(c.userForm.errors?.['passwordTooShort']).toBe(true);

      c.userForm.patchValue({
        password: 'pw123456',
        confirmPassword: 'pw123456',
        currentPassword: '',
      });
      expect(c.userForm.errors?.['currentPasswordRequired']).toBe(true);
      c.saveUser();
      expect(auth['updateMe']).not.toHaveBeenCalled();

      c.userForm.patchValue({ currentPassword: 'old-pass' });
      expect(c.userForm.errors).toBeNull();
    });

    it('shows the current password field only on the profile page', () => {
      setup({ profile: true });
      expect(fixture.nativeElement.querySelector('#currentPassword')).not.toBeNull();
    });

    it('changes the password and goes back', () => {
      setup({ profile: true });
      c.userForm.patchValue({
        currentPassword: 'old-pass',
        password: 'pw123456',
        confirmPassword: 'pw123456',
      });
      c.userForm.markAsDirty();
      c.saveUser();
      expect(auth['updateMe']).toHaveBeenCalledWith('pw123456', 'old-pass');
      expect(auth['uploadMeImage']).not.toHaveBeenCalled();
      expect(auth['notifyMeUpdated']).toHaveBeenCalled();
      expect(alert.successUpdated).toHaveBeenCalledWith('Profile');
      expect(location.back).toHaveBeenCalled();
      expect(c.userForm.controls.password.value).toBeNull();
      expect(fixture.componentInstance.canDeactivate()).toBe(true);
    });

    it('uploads only a new picture without touching the password', () => {
      setup({ profile: true });
      c.selectedFile.set(fileOf('image/png'));
      c.saveUser();
      expect(auth['updateMe']).not.toHaveBeenCalled();
      expect(auth['uploadMeImage']).toHaveBeenCalledWith(expect.any(File));
      expect(c.currentImageUrl()).toBe('http://img/me.png');
      expect(c.selectedFile()).toBeNull();
      expect(location.back).toHaveBeenCalled();
    });

    it('does not upload when the password change fails', () => {
      setup({ profile: true });
      auth['updateMe'].mockReturnValue(throwError(() => new Error('weak')));
      c.userForm.patchValue({
        currentPassword: 'old-pass',
        password: 'pw123456',
        confirmPassword: 'pw123456',
      });
      c.selectedFile.set(fileOf('image/png'));
      c.saveUser();
      expect(alert.error).toHaveBeenCalledWith('weak');
      expect(auth['uploadMeImage']).not.toHaveBeenCalled();
      expect(c.isSaving()).toBe(false);
      expect(location.back).not.toHaveBeenCalled();
    });

    it('uses a fallback message when the error has none', () => {
      setup({ profile: true });
      auth['uploadMeImage'].mockReturnValue(throwError(() => new Error('')));
      c.selectedFile.set(fileOf('image/png'));
      c.saveUser();
      expect(alert.error).toHaveBeenCalledWith('Failed to update profile.');
      expect(c.isUploading()).toBe(false);
    });

    it('goBack uses browser history', () => {
      setup({ profile: true });
      c.goBack();
      expect(location.back).toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('uploadImageAndNavigate is a no-op in profile mode', () => {
      setup({ profile: true });
      c.isSaving.set(true);
      c.uploadImageAndNavigate();
      expect(c.isSaving()).toBe(false);
      expect(service['uploadUserImage']).not.toHaveBeenCalled();
    });
  });

  describe('image selection', () => {
    it('accepts a valid image and builds a preview', async () => {
      setup();
      c.onFileSelected(fileEvent(fileOf('image/png', 100)));
      expect(c.selectedFile()).not.toBeNull();
      await vi.waitFor(() => expect(c.imagePreview()).toMatch(/^data:/));
    });

    it('rejects invalid type and oversize, accepts exactly 5MB', () => {
      setup();
      c.onFileSelected(fileEvent(fileOf('application/pdf')));
      expect(alert.errorInvalidImageType).toHaveBeenCalled();
      c.onFileSelected(fileEvent(fileOf('image/png', 5 * 1024 * 1024 + 1)));
      expect(alert.errorFileTooLarge).toHaveBeenCalled();
      expect(c.selectedFile()).toBeNull();
      c.onFileSelected(fileEvent(fileOf('image/jpeg', 5 * 1024 * 1024)));
      expect(c.selectedFile()).not.toBeNull();
    });

    it('ignores an empty input and clears via removeImage', () => {
      setup();
      c.onFileSelected({ target: { files: [] } } as unknown as Event);
      expect(c.selectedFile()).toBeNull();
      c.selectedFile.set(fileOf('image/png'));
      c.imagePreview.set('data:x');
      c.removeImage();
      expect(c.selectedFile()).toBeNull();
      expect(c.imagePreview()).toBeNull();
    });

    it('handles drag state and drops', async () => {
      setup();
      c.onDragOver(dropEvent());
      expect(c.isDragging()).toBe(true);
      c.onDragLeave(dropEvent());
      expect(c.isDragging()).toBe(false);

      c.onFileDrop(dropEvent(fileOf('text/plain')));
      expect(alert.errorInvalidImageType).toHaveBeenCalled();
      c.onFileDrop(dropEvent(fileOf('image/png', 6 * 1024 * 1024)));
      expect(alert.errorFileTooLarge).toHaveBeenCalled();
      c.onFileDrop(dropEvent());
      expect(c.selectedFile()).toBeNull();

      c.onFileDrop(dropEvent(fileOf('image/gif')));
      expect(c.selectedFile()).not.toBeNull();
      await vi.waitFor(() => expect(c.imagePreview()).toMatch(/^data:/));
    });
  });

  describe('unsaved changes guard', () => {
    it('allows leaving a pristine form', () => {
      setup();
      expect(fixture.componentInstance.canDeactivate()).toBe(true);
    });

    it('prompts when dirty and resolves true on discard', async () => {
      setup();
      c.userForm.markAsDirty();
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
      c.userForm.markAsDirty();
      const result = fixture.componentInstance.canDeactivate() as Promise<boolean>;
      c.cancelDiscard();
      await expect(result).resolves.toBe(false);
    });

    it('skips the guard after a successful save', () => {
      setup();
      fillValid();
      c.userForm.markAsDirty();
      c.saveUser();
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
