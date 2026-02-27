import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService, AuthService, ModalStackService, UserService } from '@core/services';
import { AvatarComponent, BadgeComponent, IconComponent } from '@shared/components';
import { UserDto, UserRoleEnum } from '@shared/models';

@Component({
  selector: 'app-user-details',
  imports: [CommonModule, RouterLink, IconComponent, BadgeComponent, AvatarComponent],
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

  protected readonly user = signal<UserDto | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly showDeleteModal = signal(false);
  protected readonly isDeleting = signal(false);
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
    this.router.navigate(['/management/users']);
  }

  protected navigateToEdit(): void {
    if (!this.user() || !this.canManageUserProfile(this.user()!)) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.router.navigate(['/management/users/edit', this.user()!.id]);
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
        this.router.navigateByUrl('/management/users');
      },
      error: (err) => {
        this.isDeleting.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected canWriteManagement(): boolean {
    return this.authService.canWriteManagement();
  }

  protected canManageUserProfile(user: UserDto): boolean {
    if (!this.canWriteManagement()) {
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
