import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
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
  protected readonly isLoaded = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly openBranches = computed(() => this.branchService.branches().filter((branch) => branch.isActive));
  protected readonly error = signal<string | null>(null);

  public ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loadFailed.set(false);
    this.error.set(null);
    this.branchService.getUserAccess(this.userId()).subscribe({
      next: (access) => {
        const closed = new Set(this.branchService.branches().filter((b) => !b.isActive).map((b) => b.id));

        this.isAll.set(access.isAllBranches);
        this.selectedIds.set(access.branchIds.filter((id) => !closed.has(id)));
        this.defaultId.set(access.defaultBranchId && !closed.has(access.defaultBranchId) ? access.defaultBranchId : null);
        this.isLoaded.set(true);
      },
      error: (err: Error) => {
        this.loadFailed.set(true);
        this.error.set(err.message);
      },
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
    if (!this.isLoaded() || this.isSaving()) {
      return;
    }

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
