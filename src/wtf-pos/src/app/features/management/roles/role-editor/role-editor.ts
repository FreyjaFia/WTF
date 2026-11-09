import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AlertService, AuthService, ModalStackService, RoleService } from '@core/services';
import { IconComponent, PageTitleComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { AppRoutes } from '@shared/constants/app-routes';
import { RoleDetailDto } from '@shared/models';
import { PermissionCatalog, PermissionDefinition, PermissionKey } from '@shared/permissions';

interface PermissionGroup {
  readonly area: string;
  readonly permissions: readonly PermissionDefinition[];
}

@Component({
  selector: 'app-role-editor',
  imports: [ConfirmDialogComponent, IconComponent, PageTitleComponent, ReactiveFormsModule],
  templateUrl: './role-editor.html',
  host: { class: 'flex-1 min-h-0' },
})
export class RoleEditorComponent implements OnInit {
  private readonly roleService = inject(RoleService);
  private readonly authService = inject(AuthService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly roleForm = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(50)]),
    description: new FormControl('', [Validators.maxLength(200)]),
  });

  protected readonly role = signal<RoleDetailDto | null>(null);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isDuplicating = signal(false);
  protected readonly showDiscardModal = signal(false);

  protected readonly groups: readonly PermissionGroup[] = this.buildGroups();

  protected readonly isNew = computed(() => this.roleId === null);
  protected readonly isReadOnly = computed(() => !!this.role()?.isSystem || this.cannotEditRole());
  protected readonly cannotEditRole = signal(false);
  protected readonly totalPermissions = PermissionCatalog.length;

  protected readonly summary = computed(() => {
    const keys = this.selected();
    const open: string[] = [];
    const change: string[] = [];

    for (const group of this.groups) {
      const held = group.permissions.filter((p) => keys.has(p.key));
      if (held.some((p) => p.key.endsWith('.read'))) {
        open.push(group.area);
      }

      if (held.some((p) => !p.key.endsWith('.read'))) {
        change.push(group.area);
      }
    }

    return { open, change };
  });

  private roleId: number | null = null;
  private skipGuard = false;
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private modalStackId: number | null = null;

  public ngOnInit(): void {
    // The same editor stays on screen when Duplicate opens the copy, so react to the id changing.
    const params$ = this.route.paramMap ?? of(this.route.snapshot.paramMap);
    params$.subscribe((params) => {
      const idParam = params.get('id');
      this.resetState();
      if (idParam && idParam !== 'new') {
        this.roleId = Number(idParam);
        this.loadRole(this.roleId);
      }
    });
  }

  public canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.isDirty()) {
      return true;
    }

    this.showDiscardModal.set(true);
    this.modalStackId = this.modalStack.push(() => this.cancelDiscard());
    return new Promise((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected canGive(permission: PermissionDefinition): boolean {
    return this.authService.can(permission.key);
  }

  protected isChecked(key: string): boolean {
    return this.selected().has(key);
  }

  protected isDisabled(permission: PermissionDefinition): boolean {
    return this.isReadOnly() || this.isSaving() || (!this.isChecked(permission.key) && !this.canGive(permission));
  }

  protected togglePermission(permission: PermissionDefinition): void {
    if (this.isDisabled(permission)) {
      return;
    }

    const next = new Set(this.selected());
    if (next.has(permission.key)) {
      this.removeWithDependents(next, permission.key);
    } else {
      this.addWithRequirements(next, permission.key);
    }

    this.selected.set(next);
    this.roleForm.markAsDirty();
  }

  protected areaCount(group: PermissionGroup): number {
    return group.permissions.filter((p) => this.selected().has(p.key)).length;
  }

  protected requirementLabels(permission: PermissionDefinition): string {
    return permission.requires
      .map((key) => PermissionCatalog.find((p) => p.key === key)?.label ?? key)
      .join(', ');
  }

  protected save(): void {
    if (this.isReadOnly() || this.roleForm.invalid || this.isSaving()) {
      this.roleForm.markAllAsTouched();
      return;
    }

    const dto = {
      name: (this.roleForm.controls.name.value ?? '').trim(),
      description: (this.roleForm.controls.description.value ?? '').trim() || null,
      permissions: [...this.selected()],
    };

    this.isSaving.set(true);
    const request$ =
      this.roleId === null
        ? this.roleService.createRole(dto)
        : this.roleService.updateRole(this.roleId, dto);

    request$.subscribe({
      next: () => {
        this.skipGuard = true;
        this.isSaving.set(false);
        if (this.roleId === null) {
          this.alertService.successCreated('Role');
        } else {
          this.alertService.successUpdated('Role');
        }

        this.goBack();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected duplicate(): void {
    const current = this.role();
    if (!current || this.isDuplicating()) {
      return;
    }

    this.isDuplicating.set(true);
    this.roleService.duplicateRole(current.id).subscribe({
      next: (copy) => {
        this.isDuplicating.set(false);
        this.alertService.successCreated('Role');
        this.router.navigateByUrl(AppRoutes.ManagementRoleById(copy.id));
      },
      error: (err: Error) => {
        this.isDuplicating.set(false);
        this.alertService.error(err.message);
      },
    });
  }

  protected goBack(): void {
    this.router.navigateByUrl(AppRoutes.ManagementRoles);
  }

  protected cancelDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);
    this.pendingDeactivateResolve?.(false);
    this.pendingDeactivateResolve = null;
  }

  protected confirmDiscard(): void {
    this.removeFromStack();
    this.showDiscardModal.set(false);
    this.pendingDeactivateResolve?.(true);
    this.pendingDeactivateResolve = null;
  }

  private resetState(): void {
    this.roleId = null;
    this.skipGuard = false;
    this.role.set(null);
    this.selected.set(new Set());
    this.cannotEditRole.set(false);
    this.roleForm.enable({ emitEvent: false });
    this.roleForm.reset({ name: '', description: '' }, { emitEvent: false });
  }

  private isDirty(): boolean {
    return this.roleForm.dirty;
  }

  private loadRole(id: number): void {
    this.isLoading.set(true);
    this.roleService.getRole(id).subscribe({
      next: (role) => {
        this.role.set(role);
        this.selected.set(new Set(role.permissions));
        this.roleForm.patchValue(
          { name: role.name, description: role.description ?? '' },
          { emitEvent: false },
        );
        if (role.isSystem) {
          this.roleForm.disable({ emitEvent: false });
        } else if (role.permissions.some((key) => !this.authService.can(key as PermissionKey))) {
          // The server refuses to change a role that carries permissions you do not hold yourself.
          this.cannotEditRole.set(true);
          this.roleForm.disable({ emitEvent: false });
        }

        this.isLoading.set(false);
      },
      error: (err: Error) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.goBack();
      },
    });
  }

  private buildGroups(): PermissionGroup[] {
    const byArea = new Map<string, PermissionDefinition[]>();
    for (const permission of PermissionCatalog) {
      const list = byArea.get(permission.area) ?? [];
      list.push(permission);
      byArea.set(permission.area, list);
    }

    return [...byArea.entries()].map(([area, permissions]) => ({ area, permissions }));
  }

  private addWithRequirements(set: Set<string>, key: string): void {
    if (set.has(key)) {
      return;
    }

    set.add(key);
    const definition = PermissionCatalog.find((p) => p.key === key);
    for (const required of definition?.requires ?? []) {
      this.addWithRequirements(set, required);
    }
  }

  private removeWithDependents(set: Set<string>, key: string): void {
    set.delete(key);
    for (const permission of PermissionCatalog) {
      if (set.has(permission.key) && permission.requires.includes(key as never)) {
        this.removeWithDependents(set, permission.key);
      }
    }
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }
}
