import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, AuthService, UserService } from '@core/services';
import { AvatarComponent, Icon } from '@shared/components';
import { CreateUserDto, UpdateUserDto, UserRoleEnum } from '@shared/models';
import { jwtDecode } from 'jwt-decode';
import { of, switchMap } from 'rxjs';

@Component({
  selector: 'app-user-editor',
  imports: [CommonModule, ReactiveFormsModule, Icon, AvatarComponent],
  templateUrl: './user-editor.html',
  host: {
    class: 'block h-full',
  },
})
export class UserEditorComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);

  // UI state signals
  protected readonly isEditMode = signal(false);
  protected readonly isProfileMode = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);
  protected readonly userFullNameLabel = signal('');
  protected readonly lastUpdatedAt = signal<string | null>(null);
  protected currentUserRoleLabel = 'Unknown';
  protected readonly userRoleOptions = [
    { label: 'Admin', value: UserRoleEnum.Admin },
    { label: 'Cashier', value: UserRoleEnum.Cashier },
    { label: 'Admin Viewer', value: UserRoleEnum.AdminViewer },
  ];

  // Image upload signals
  protected readonly isUploading = signal(false);
  protected readonly isDeletingImage = signal(false);
  protected readonly isDragging = signal(false);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly imagePreview = signal<string | null>(null);
  protected readonly currentImageUrl = signal<string | null>(null);

  // Form group
  protected readonly userForm = new FormGroup(
    {
      firstName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      lastName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      username: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      roleId: new FormControl<UserRoleEnum | null>(null),
      password: new FormControl('', {
        nonNullable: false,
        validators: [Validators.maxLength(100)],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: false,
        validators: [Validators.maxLength(100)],
      }),
    },
    { validators: [(control) => this.passwordRulesValidator(control)] },
  );

  // Unsaved changes guard
  protected readonly showDiscardModal = signal(false);
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private skipGuard = false;

  protected userId: string | null = null;

  public ngOnInit(): void {
    this.userFullNameLabel.set(
      `${this.userForm.controls.firstName.value || ''} ${this.userForm.controls.lastName.value || ''}`.trim(),
    );
    this.userForm.valueChanges.subscribe(() => {
      const first = this.userForm.controls.firstName.value || '';
      const last = this.userForm.controls.lastName.value || '';
      this.userFullNameLabel.set(`${first} ${last}`.trim());
    });

    const isProfile = this.route.snapshot.data['isProfile'] === true;
    this.isProfileMode.set(isProfile);

    if (isProfile) {
      const currentUserId = this.getCurrentUserIdFromToken();

      if (!currentUserId) {
        this.alertService.error('Unable to load profile. Please sign in again.');
        this.router.navigateByUrl('/login');
        return;
      }

      this.isEditMode.set(true);
      this.userId = currentUserId;
      this.currentUserRoleLabel = this.authService.getCurrentRoleLabel();
      this.applyPasswordValidators();
      this.applyRoleValidators();
      this.loadUser(currentUserId);
      return;
    }

    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.isEditMode.set(true);
      this.userId = id;
      this.applyPasswordValidators();
      this.applyRoleValidators();
      this.loadUser(id);
    } else {
      this.applyPasswordValidators();
      this.applyRoleValidators();
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
    const fileInput = document.getElementById('userImage') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  protected removeCurrentImage(): void {
    if (!this.userId || !this.currentImageUrl() || this.isDeletingImage()) {
      return;
    }

    this.isDeletingImage.set(true);
    this.userService.deleteUserImage(this.userId).subscribe({
      next: (updatedUser) => {
        this.currentImageUrl.set(updatedUser.imageUrl || null);
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

  protected uploadImage(userId?: string): void {
    const file = this.selectedFile();
    const id = userId || this.userId;
    if (!file || !id) {
      return;
    }
    this.isUploading.set(true);
    this.userService.uploadUserImage(id, file).subscribe({
      next: (user) => {
        this.currentImageUrl.set(user.imageUrl || null);
        this.isUploading.set(false);
        this.selectedFile.set(null);
        this.imagePreview.set(null);
        this.alertService.successUploaded();
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isUploading.set(false);
      },
    });
  }

  private loadUser(id: string): void {
    this.isLoading.set(true);

    this.userService.getUserById(id).subscribe({
      next: (user) => {
        this.userForm.patchValue({
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          roleId: UserRoleEnum[user.roleId] !== undefined ? user.roleId : null,
        });
        this.currentImageUrl.set(user.imageUrl || null);
        this.lastUpdatedAt.set(user.updatedAt || user.createdAt);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected saveUser(): void {
    if (this.isProfileMode()) {
      this.saveProfile();
      return;
    }

    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);

    if (this.isEditMode()) {
      const dto: UpdateUserDto = {
        id: this.userId!,
        firstName: this.userForm.controls.firstName.value!,
        lastName: this.userForm.controls.lastName.value!,
        username: this.userForm.controls.username.value!,
        password: this.userForm.controls.password.value || undefined,
        roleId: this.userForm.controls.roleId.value!,
      };

      this.userService.updateUser(dto).subscribe({
        next: () => {
          // If there's a file selected, upload it after updating the user
          if (this.selectedFile()) {
            this.uploadImageAndNavigate();
          } else {
            this.isSaving.set(false);
            this.skipGuard = true;
            this.alertService.successUpdated('User');
            this.navigateToDetails(this.userId!);
          }
        },
        error: (err) => {
          this.alertService.error(err.message);
          this.isSaving.set(false);
        },
      });
    } else {
      const dto: CreateUserDto = {
        firstName: this.userForm.controls.firstName.value!,
        lastName: this.userForm.controls.lastName.value!,
        username: this.userForm.controls.username.value!,
        password: this.userForm.controls.password.value!,
        roleId: this.userForm.controls.roleId.value!,
      };

      this.userService.createUser(dto).subscribe({
        next: (createdUser) => {
          // If there's a file selected, upload it after creating the user
          if (this.selectedFile()) {
            this.uploadImageAndNavigate(createdUser.id);
          } else {
            this.isSaving.set(false);
            this.skipGuard = true;
            this.alertService.successCreated('User');
            this.navigateToDetails(createdUser.id);
          }
        },
        error: (err) => {
          this.alertService.error(err.message);
          this.isSaving.set(false);
        },
      });
    }
  }

  private saveProfile(): void {
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }

    const password = (this.userForm.controls.password.value || '').trim();
    const hasPasswordUpdate = password.length > 0;
    const hasImageUpdate = !!this.selectedFile();

    if (!hasPasswordUpdate && !hasImageUpdate) {
      this.alertService.errorNothingToUpdate();
      return;
    }

    this.isSaving.set(true);

    const updatePassword$ = hasPasswordUpdate ? this.authService.updateMe(password) : of(void 0);

    updatePassword$
      .pipe(
        switchMap(() => {
          const file = this.selectedFile();
          if (!file) {
            return of(null);
          }

          this.isUploading.set(true);
          return this.authService.uploadMeImage(file);
        }),
      )
      .subscribe({
        next: (updated) => {
          if (updated?.imageUrl) {
            this.currentImageUrl.set(updated.imageUrl);
          }

          this.isUploading.set(false);
          this.isSaving.set(false);
          this.selectedFile.set(null);
          this.imagePreview.set(null);
          this.userForm.controls.password.setValue(null);
          this.userForm.controls.confirmPassword.setValue(null);
          this.userForm.markAsPristine();
          this.skipGuard = true;
          this.authService.notifyMeUpdated();
          this.alertService.successUpdated('Profile');
          this.goBack();
        },
        error: (err) => {
          this.alertService.error(
            err.message || this.alertService.getUpdateErrorMessage('profile'),
          );
          this.isUploading.set(false);
          this.isSaving.set(false);
        },
      });
  }

  protected uploadImageAndNavigate(userId?: string): void {
    if (this.isProfileMode()) {
      this.isSaving.set(false);
      return;
    }

    const file = this.selectedFile();
    const id = userId || this.userId;
    if (!file || !id) {
      this.isSaving.set(false);
      return;
    }
    this.isUploading.set(true);
    this.userService.uploadUserImage(id, file).subscribe({
      next: (updatedUser) => {
        this.currentImageUrl.set(updatedUser.imageUrl || null);
        this.isUploading.set(false);
        this.selectedFile.set(null);
        this.imagePreview.set(null);
        this.isSaving.set(false);
        this.skipGuard = true;
        if (userId) {
          this.alertService.successCreated('User');
          this.navigateToDetails(userId);
        } else if (this.userId) {
          this.alertService.successUpdated('User');
          this.navigateToDetails(this.userId);
        }
      },
      error: (err) => {
        this.alertService.error(err.message || this.alertService.getUploadErrorMessage('image'));
        this.isUploading.set(false);
        this.isSaving.set(false);
      },
    });
  }

  protected goBack(): void {
    if (this.isProfileMode()) {
      this.router.navigate(['/orders/list']);
      return;
    }

    if (this.isEditMode() && this.userId) {
      this.router.navigate(['/management/users/details', this.userId]);
    } else {
      this.router.navigate(['/management/users']);
    }
  }

  private navigateToDetails(userId: string) {
    this.router.navigate(['/management/users/details', userId]);
  }

  protected hasError(control: string): boolean {
    const ctrl = this.userForm.get(control);
    const touched = !!ctrl && (ctrl.dirty || ctrl.touched);
    const hasControlError = !!ctrl && ctrl.invalid && touched;

    if (
      control === 'confirmPassword' &&
      touched &&
      (this.userForm.errors?.['passwordMismatch'] ||
        this.userForm.errors?.['confirmPasswordRequired'])
    ) {
      return true;
    }

    if (control === 'password' && touched && this.userForm.errors?.['passwordRequired']) {
      return true;
    }

    return hasControlError;
  }

  protected getErrorMessage(control: string): string | null {
    if (!this.hasError(control)) {
      return null;
    }

    if (control === 'confirmPassword' && this.userForm.errors?.['passwordMismatch']) {
      return 'Passwords do not match.';
    }
    if (control === 'confirmPassword' && this.userForm.errors?.['confirmPasswordRequired']) {
      return 'Please re-enter your password.';
    }
    if (control === 'password' && this.userForm.errors?.['passwordRequired']) {
      return 'Password is required when confirm password is set.';
    }

    const ctrl = this.userForm.get(control);
    if (!ctrl || !ctrl.errors) {
      return null;
    }
    if (ctrl.errors['required']) {
      return 'This field is required.';
    }
    if (ctrl.errors['maxlength']) {
      return `Maximum length is ${ctrl.errors['maxlength'].requiredLength}.`;
    }
    return null;
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.userForm.dirty) {
      return true;
    }

    this.showDiscardModal.set(true);
    return new Promise((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected cancelDiscard(): void {
    this.showDiscardModal.set(false);
    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(false);
      this.pendingDeactivateResolve = null;
    }
  }

  protected confirmDiscard(): void {
    this.showDiscardModal.set(false);

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(true);
      this.pendingDeactivateResolve = null;
    }
  }

  protected userFullName(): string {
    const first = this.userForm.controls.firstName.value || '';
    const last = this.userForm.controls.lastName.value || '';
    return `${first} ${last}`.trim();
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.set(!this.showPassword());
  }

  protected toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.set(!this.showConfirmPassword());
  }

  private applyPasswordValidators(): void {
    const passwordCtrl = this.userForm.controls.password;
    const confirmCtrl = this.userForm.controls.confirmPassword;

    if (this.isEditMode()) {
      passwordCtrl.setValidators([Validators.maxLength(100)]);
      confirmCtrl.setValidators([Validators.maxLength(100)]);
    } else {
      passwordCtrl.setValidators([Validators.required, Validators.maxLength(100)]);
      confirmCtrl.setValidators([Validators.required, Validators.maxLength(100)]);
    }

    passwordCtrl.updateValueAndValidity({ emitEvent: false });
    confirmCtrl.updateValueAndValidity({ emitEvent: false });
    this.userForm.updateValueAndValidity({ emitEvent: false });
  }

  private applyRoleValidators(): void {
    const roleCtrl = this.userForm.controls.roleId;

    if (this.isProfileMode()) {
      roleCtrl.clearValidators();
      roleCtrl.disable({ emitEvent: false });
    } else {
      roleCtrl.setValidators([Validators.required]);
      roleCtrl.enable({ emitEvent: false });
    }

    roleCtrl.updateValueAndValidity({ emitEvent: false });
    this.userForm.updateValueAndValidity({ emitEvent: false });
  }

  private passwordRulesValidator(control: AbstractControl): ValidationErrors | null {
    const password = (control.get('password')?.value as string | null) ?? '';
    const confirmPassword = (control.get('confirmPassword')?.value as string | null) ?? '';
    const passwordTrimmed = password.trim();
    const confirmTrimmed = confirmPassword.trim();

    if (this.isEditMode()) {
      if (!passwordTrimmed && !confirmTrimmed) {
        return null;
      }
      if (passwordTrimmed && !confirmTrimmed) {
        return { confirmPasswordRequired: true };
      }
      if (!passwordTrimmed && confirmTrimmed) {
        return { passwordRequired: true };
      }
      if (passwordTrimmed !== confirmTrimmed) {
        return { passwordMismatch: true };
      }
      return null;
    }

    if (!passwordTrimmed || !confirmTrimmed) {
      return null;
    }
    if (passwordTrimmed !== confirmTrimmed) {
      return { passwordMismatch: true };
    }

    return null;
  }

  private getCurrentUserIdFromToken(): string | null {
    const token = this.authService.getToken();

    if (!token) {
      return null;
    }

    try {
      const decoded = jwtDecode<Record<string, unknown>>(token);
      const claimCandidates = [
        decoded['sub'],
        decoded['nameid'],
        decoded['user_id'],
        decoded['uid'],
        decoded['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'],
      ];

      for (const claim of claimCandidates) {
        if (typeof claim === 'string' && claim.trim()) {
          return claim;
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
