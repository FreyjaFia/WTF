import { Component, inject, input, OnInit, signal } from '@angular/core';
import { AlertService, BranchService } from '@core/services';

@Component({
  selector: 'app-user-branch-access',
  templateUrl: './user-branch-access.html',
})
export class UserBranchAccessComponent implements OnInit {
  public readonly userId = input.required<string>();

  protected readonly branchService = inject(BranchService);
  private readonly alertService = inject(AlertService);

  protected readonly isAll = signal(true);
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly defaultId = signal<string | null>(null);
  protected readonly isSaving = signal(false);
  protected readonly error = signal<string | null>(null);

  public ngOnInit(): void {
    this.branchService.getUserAccess(this.userId()).subscribe({
      next: (access) => {
        this.isAll.set(access.isAllBranches);
        this.selectedIds.set(access.branchIds);
        this.defaultId.set(access.defaultBranchId);
      },
      error: (err: Error) => this.error.set(err.message),
    });
  }

  protected setAll(checked: boolean): void {
    this.isAll.set(checked);
  }

  protected toggle(id: string, checked: boolean): void {
    this.selectedIds.update((ids) => (checked ? [...ids, id] : ids.filter((x) => x !== id)));
    if (!checked && this.defaultId() === id) {
      this.defaultId.set(null);
    }
  }

  protected chooseDefault(event: Event): void {
    this.defaultId.set((event.target as HTMLSelectElement).value || null);
  }

  protected save(): void {
    if (!this.isAll() && this.selectedIds().length === 0) {
      this.error.set('Pick at least one branch, or allow all branches.');
      return;
    }

    this.isSaving.set(true);
    this.error.set(null);
    this.branchService
      .saveUserAccess(this.userId(), {
        isAllBranches: this.isAll(),
        branchIds: this.isAll() ? [] : this.selectedIds(),
        defaultBranchId: this.defaultId(),
      })
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.alertService.success('Branch access saved.');
        },
        error: (err: Error) => {
          this.isSaving.set(false);
          this.error.set(err.message);
        },
      });
  }
}
