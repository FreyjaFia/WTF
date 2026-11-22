import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService, AuthService, BranchService, ModalStackService } from '@core/services';
import { BranchDto } from '@shared/models';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchesComponent } from './branches';

const branch = (overrides: Partial<BranchDto> = {}): BranchDto =>
  ({
    id: 'b1',
    name: 'Makati Main Branch',
    code: 'MKT',
    address: 'Ayala Avenue, Makati',
    phone: '0917 555 0142',
    isMain: true,
    isActive: true,
    staffCount: 4,
    ...overrides,
  }) as BranchDto;

interface Vm {
  dialog: () => string | null;
  showDiscardModal: () => boolean;
  form: { controls: { name: { setValue: (v: string) => void; markAsDirty: () => void } } };
  openEdit: (b: BranchDto) => void;
  openAdd: () => void;
  cancelDialog: () => void;
  confirmDiscard: () => void;
  keepEditing: () => void;
}

describe('BranchesComponent', () => {
  let service: { getBranches: ReturnType<typeof vi.fn>; updateBranch: ReturnType<typeof vi.fn> };
  let vm: Vm;
  let host: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<BranchesComponent>>;

  beforeEach(() => {
    service = {
      getBranches: vi.fn().mockReturnValue(of([branch()])),
      updateBranch: vi.fn().mockReturnValue(of(branch())),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: BranchService, useValue: service },
        { provide: AlertService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: AuthService, useValue: { canManageBranches: () => true } },
        { provide: ModalStackService, useValue: { push: vi.fn().mockReturnValue(1), remove: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(BranchesComponent);
    fixture.detectChanges();
    vm = fixture.componentInstance as unknown as Vm;
    host = fixture.nativeElement as HTMLElement;
  });

  it('closes the edit dialog at once when nothing was changed', () => {
    vm.openEdit(branch());

    vm.cancelDialog();

    expect(vm.dialog()).toBeNull();
    expect(vm.showDiscardModal()).toBe(false);
  });

  it('asks "Discard Changes?" when the form was changed, and keeps the dialog on Keep Editing', () => {
    vm.openEdit(branch());
    vm.form.controls.name.setValue('Makati Ayala');
    vm.form.controls.name.markAsDirty();

    vm.cancelDialog();
    fixture.detectChanges();

    expect(vm.showDiscardModal()).toBe(true);
    expect(host.textContent).toContain('Discard Changes?');
    expect(vm.dialog()).toBe('edit');

    vm.keepEditing();
    expect(vm.showDiscardModal()).toBe(false);
    expect(vm.dialog()).toBe('edit');
  });

  it('closes the dialog and drops the changes once the person confirms', () => {
    vm.openEdit(branch());
    vm.form.controls.name.setValue('Makati Ayala');
    vm.form.controls.name.markAsDirty();
    vm.cancelDialog();

    vm.confirmDiscard();

    expect(vm.dialog()).toBeNull();
    expect(vm.showDiscardModal()).toBe(false);
    expect(service.updateBranch).not.toHaveBeenCalled();
  });

  it('asks before throwing away a half-filled new branch too', () => {
    vm.openAdd();
    vm.form.controls.name.setValue('Cebu IT Park');
    vm.form.controls.name.markAsDirty();

    vm.cancelDialog();

    expect(vm.showDiscardModal()).toBe(true);
  });
});
