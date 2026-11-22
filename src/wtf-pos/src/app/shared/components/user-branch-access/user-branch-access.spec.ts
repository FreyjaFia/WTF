import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlertService, BranchService } from '@core/services';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserBranchAccessComponent } from './user-branch-access';

describe('UserBranchAccessComponent', () => {
  const branches = [
    { id: 'b-1', name: 'Makati Main Branch', code: 'MKT', isActive: true },
    { id: 'b-2', name: 'BGC Taguig', code: 'BGC', isActive: true },
    { id: 'b-3', name: 'Old Kiosk', code: 'OLD', isActive: false },
  ];
  const access = { userId: 'u-1', isAllBranches: false, branchIds: ['b-1', 'b-3'], defaultBranchId: 'b-3' };
  let getUserAccess: ReturnType<typeof vi.fn>;
  let saveUserAccess: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<UserBranchAccessComponent>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const saveButton = (): HTMLButtonElement => el().querySelector('[data-testid="save-branch-access"]') as HTMLButtonElement;

  function setup(): void {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BranchService,
          useValue: { isMultiBranch: () => true, branches: () => branches, getUserAccess, saveUserAccess },
        },
        { provide: AlertService, useValue: { success: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(UserBranchAccessComponent);
    fixture.componentRef.setInput('userId', 'u-1');
    fixture.detectChanges();
  }

  beforeEach(() => {
    getUserAccess = vi.fn(() => of(access));
    saveUserAccess = vi.fn(() => of(access));
  });

  it('cannot be saved until the current access has loaded', () => {
    const pending = new Subject<typeof access>();
    getUserAccess.mockReturnValue(pending);
    setup();

    expect(saveButton().disabled).toBe(true);
    expect(el().querySelector('[data-testid="branch-access-loading"]')).not.toBeNull();

    saveButton().click();
    expect(saveUserAccess).not.toHaveBeenCalled();

    pending.next(access);
    fixture.detectChanges();

    expect(saveButton().disabled).toBe(false);
  });

  it('offers a retry when the access could not be loaded, and cannot be saved meanwhile', () => {
    getUserAccess.mockReturnValueOnce(throwError(() => new Error('Unable to fetch the branch access.')));
    setup();

    expect(saveButton().disabled).toBe(true);
    expect(el().querySelector('[data-testid="branch-access-load-error"]')?.textContent).toContain('Unable to fetch');

    (el().querySelector('[data-testid="retry-branch-access"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(getUserAccess).toHaveBeenCalledTimes(2);
    expect(saveButton().disabled).toBe(false);
    expect(el().querySelector('[data-testid="branch-access-load-error"]')).toBeNull();
  });

  it('does not list closed branches, and drops them from what is shown and saved', () => {
    setup();

    expect(el().querySelector('[data-testid="branch-access-MKT"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="branch-access-BGC"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="branch-access-OLD"]')).toBeNull();
    expect(el().querySelector('#branch-access-default')?.textContent).not.toContain('Old Kiosk');

    saveButton().click();

    expect(saveUserAccess).toHaveBeenCalledWith('u-1', {
      isAllBranches: false,
      branchIds: ['b-1'],
      defaultBranchId: null,
    });
  });

  it('says it has unsaved changes only after something was changed, and clears that once saved', () => {
    setup();
    expect(fixture.componentInstance.isDirty()).toBe(false);

    (el().querySelector('[data-testid="branch-access-BGC"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.isDirty()).toBe(true);

    (el().querySelector('[data-testid="branch-access-BGC"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.isDirty()).toBe(false);

    (el().querySelector('[data-testid="branch-access-BGC"]') as HTMLInputElement).click();
    fixture.detectChanges();
    saveButton().click();
    fixture.detectChanges();
    expect(fixture.componentInstance.isDirty()).toBe(false);
  });
});
