import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, ModalStackService, UserService } from '@core/services';
import { AvatarComponent, BadgeComponent, IconComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { UserDto, UserRoleEnum } from '@shared/models';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-user-details',
  imports: [CommonModule, RouterLink, IconComponent, BadgeComponent, AvatarComponent, ConfirmDialogComponent],
  templateUrl: './user-details.html',
  host: {
    class: 'block h-full',
  },
})
export class UserDetailsComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly modalStack = inject(ModalStackService);
  protected readonly routes = AppRoutes;

  protected readonly user = signal<UserDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
  protected readonly showRestoreModal = signal(false);
  protected readonly isRestoring = signal(false);
  private modalStackId: number | null = null;
  // For image preview consistency with editor
  protected readonly currentImageUrl = signal<string | null>(null);

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.loadUser(id);
    }
  }

  private loadUser(id: string): void {
    this.isLoading.set(true);

    this.userService.getUserById(id).subscribe({
      next: (user) => {
        this.user.set(user);
        this.currentImageUrl.set(user.imageUrl || null);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  protected goBack(): void {
    this.router.navigateByUrl(AppRoutes.ManagementUsers);
  }

  protected navigateToEdit(): void {
    if (!this.user() || !this.canManageUserProfile(this.user()!)) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.router.navigateByUrl(AppRoutes.ManagementUserEditById(this.user()!.id));
  }

  protected restoreUser(): void {
    const user = this.user();
    if (!user || !this.canManageUserProfile(user)) {
      this.alertService.errorUnauthorized();
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

    const user = this.user();
    if (!user || !this.canManageUserProfile(user)) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.isRestoring.set(true);
    this.userService.restoreUser(user.id).subscribe({
      next: () => {
        this.isRestoring.set(false);
        this.showRestoreModal.set(false);
        this.removeFromStack();
        this.alertService.successRestored('User');
        this.loadUser(user.id);
      },
      error: (err) => {
        this.isRestoring.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected deleteUser(): void {
    if (!this.user() || !this.canManageUserProfile(this.user()!)) {
      this.alertService.errorUnauthorized();
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

    if (!this.user() || !this.canManageUserProfile(this.user()!)) {
      this.alertService.errorUnauthorized();
      return;
    }

    const userId = this.user()!.id;
    this.isDeleting.set(true);

    this.userService.deleteUser(userId).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.removeFromStack();
        this.alertService.successDeleted('User');
        this.router.navigateByUrl(AppRoutes.ManagementUsers);
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected canWriteUsers(): boolean {
    return this.authService.canWriteUsers();
  }

  protected canManageUserProfile(user: UserDto): boolean {
    if (!this.canWriteUsers()) {
      return false;
    }

    if (user.roleId === UserRoleEnum.SuperAdmin) {
      return this.authService.isSuperAdmin();
    }

    return true;
  }

  protected getRoleLabel(user: UserDto): string {
    const enumName = UserRoleEnum[user.roleId];
    if (!enumName || typeof enumName !== 'string') {
      return 'Unknown';
    }
    return enumName.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
