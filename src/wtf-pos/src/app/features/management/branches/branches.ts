import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { HttpErrorMessages } from '@core/messages';
import { AlertService, AuthService, BranchService, ModalStackService } from '@core/services';
import { BadgeComponent, ConnectionErrorComponent, IconComponent } from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { PullToRefreshComponent } from '@shared/components/pull-to-refresh/pull-to-refresh';
import { SortDirection, SortHeaderComponent } from '@shared/components/sort-header/sort-header';
import { BranchCloseCheckDto, BranchDto } from '@shared/models';
import { ClientPager } from '@shared/utils/client-pager';

type BranchDialog = 'edit' | 'close' | 'reopen' | 'main';

type SortColumn = 'name' | 'code' | 'staff' | 'status';

@Component({
  selector: 'app-branches',
  imports: [
    BadgeComponent,
    ConfirmDialogComponent,
    ConnectionErrorComponent,
    IconComponent,
    PaginationComponent,
    PullToRefreshComponent,
    ReactiveFormsModule,
    SortHeaderComponent,
  ],
  templateUrl: './branches.html',
  host: { class: 'flex-1 min-h-0' },
})
export class BranchesComponent implements OnInit, OnDestroy {
  private readonly branchService = inject(BranchService);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly authService = inject(AuthService);

  protected readonly isAndroid = Capacitor.getPlatform() === 'android';
  protected readonly canManage = computed(() => this.authService.canManageBranches());
  protected readonly branches = signal<BranchDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly dialog = signal<BranchDialog | null>(null);
  protected readonly selected = signal<BranchDto | null>(null);
  protected readonly closeCheck = signal<BranchCloseCheckDto | null>(null);
  protected readonly moveStaffTo = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly sortColumn = signal<SortColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly otherActiveBranches = computed(() =>
    this.branches().filter((b) => b.isActive && b.id !== this.selected()?.id),
  );
  protected readonly sortedBranches = computed(() => {
    const column = this.sortColumn();
    const factor = this.sortDirection() === 'asc' ? 1 : -1;
    return [...this.branches()].sort((a, b) => {
      if (column) {
        const byColumn =
          column === 'name'
            ? a.name.localeCompare(b.name)
            : column === 'code'
              ? a.code.localeCompare(b.code)
              : column === 'staff'
                ? a.staffCount - b.staffCount
                : Number(a.isActive) - Number(b.isActive);
        if (byColumn !== 0) {
          return byColumn * factor;
        }
      }

      return (
        Number(b.isMain) - Number(a.isMain) ||
        Number(b.isActive) - Number(a.isActive) ||
        a.name.localeCompare(b.name)
      );
    });
  });
  protected readonly pager = new ClientPager(
    computed(() => this.sortedBranches()),
    'management:branches',
    computed(() => [this.sortColumn(), this.sortDirection()]),
  );
  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[A-Za-z0-9]{2,5}$/)],
    }),
    address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
  });

  private modalStackId: number | null = null;

  public ngOnInit(): void {
    this.loadBranches();
  }

  public ngOnDestroy(): void {
    this.removeFromStack();
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadBranches();
  }

  protected openAdd(): void {
    this.selected.set(null);
    this.form.reset({ name: '', code: '', address: '', phone: '' });
    this.openDialog('edit');
  }

  protected openEdit(branch: BranchDto): void {
    this.selected.set(branch);
    this.form.reset({
      name: branch.name,
      code: branch.code,
      address: branch.address ?? '',
      phone: branch.phone ?? '',
    });
    this.openDialog('edit');
  }

  protected openClose(branch: BranchDto): void {
    this.selected.set(branch);
    this.closeCheck.set(null);
    this.moveStaffTo.set(null);
    this.openDialog('close');
    this.branchService.getCloseCheck(branch.id).subscribe({
      next: (check) => {
        this.closeCheck.set(check);
        this.moveStaffTo.set(this.otherActiveBranches()[0]?.id ?? null);
      },
      error: (err: Error) => this.formError.set(err.message),
    });
  }

  protected openReopen(branch: BranchDto): void {
    this.selected.set(branch);
    this.openDialog('reopen');
  }

  protected openMakeMain(branch: BranchDto): void {
    this.selected.set(branch);
    this.openDialog('main');
  }

  protected chooseMoveTarget(event: Event): void {
    this.moveStaffTo.set((event.target as HTMLSelectElement).value || null);
  }

  protected closeDialog(): void {
    if (this.isSaving()) {
      return;
    }

    this.dialog.set(null);
    this.selected.set(null);
    this.closeCheck.set(null);
    this.formError.set(null);
    this.removeFromStack();
  }

  protected saveBranch(): void {
    this.form.markAllAsTouched();
    const value = this.form.getRawValue();
    const name = value.name.trim();
    if (this.form.invalid || name.length === 0) {
      this.formError.set('Enter a name and a code of 2 to 5 letters or numbers.');
      return;
    }

    const dto = {
      name,
      code: value.code.trim().toUpperCase(),
      address: value.address.trim() || null,
      phone: value.phone.trim() || null,
    };
    const current = this.selected();
    const request = current
      ? this.branchService.updateBranch(current.id, dto)
      : this.branchService.createBranch(dto);

    this.run(request, current ? 'Branch saved.' : 'Branch added.');
  }

  protected confirmClose(): void {
    const branch = this.selected();
    if (!branch) {
      return;
    }

    this.run(
      this.branchService.closeBranch(branch.id, this.moveStaffTo()),
      `${branch.name} is closed.`,
    );
  }

  protected confirmReopen(): void {
    const branch = this.selected();
    if (branch) {
      this.run(this.branchService.reopenBranch(branch.id), `${branch.name} is open again.`);
    }
  }

  protected confirmMakeMain(): void {
    const branch = this.selected();
    if (branch) {
      this.run(this.branchService.makeMain(branch.id), `${branch.name} is now the main branch.`);
    }
  }

  private run(request: ReturnType<BranchService['closeBranch']>, success: string): void {
    this.isSaving.set(true);
    this.formError.set(null);
    request.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.alertService.success(success);
        this.dialog.set(null);
        this.selected.set(null);
        this.removeFromStack();
        this.loadBranches();
      },
      error: (err: Error) => {
        this.isSaving.set(false);
        this.formError.set(err.message);
      },
    });
  }

  private openDialog(kind: BranchDialog): void {
    this.formError.set(null);
    this.dialog.set(kind);
    this.removeFromStack();
    this.modalStackId = this.modalStack.push(() => this.closeDialog());
  }

  private removeFromStack(): void {
    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  private loadBranches(): void {
    this.isLoading.set(!this.isRefreshing());
    this.connectionFailed.set(false);
    this.branchService.getBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }
}
