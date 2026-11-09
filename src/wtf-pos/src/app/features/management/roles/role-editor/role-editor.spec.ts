import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AlertService, AuthService, ModalStackService, RoleService } from '@core/services';
import { PermissionPlanDto, RoleDetailDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAlert, internals, Internals, stubRoute } from '../../../../testing/management-spec-helpers';
import { RoleEditorComponent } from './role-editor';

const CUSTOM: RoleDetailDto = {
  id: 100,
  name: 'Shift Lead',
  description: 'Runs the floor',
  isSystem: false,
  userCount: 1,
  permissions: ['orders.read', 'orders.write'],
};
const SYSTEM: RoleDetailDto = { ...CUSTOM, id: 2, name: 'Cashier', isSystem: true };

describe('RoleEditorComponent', () => {
  let fixture: ComponentFixture<RoleEditorComponent>;
  let c: Internals;
  let alert: ReturnType<typeof fakeAlert>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let router: Router;

  function setup(opts: {
    id?: string;
    role?: RoleDetailDto;
    held?: (key: string) => boolean;
    plans?: PermissionPlanDto[];
  } = {}) {
    alert = fakeAlert();
    service = {
      getPermissionPlans: vi.fn(() => of(opts.plans ?? [])),
      getRole: vi.fn(() => (opts.role ? of(opts.role) : throwError(() => new Error('gone')))),
      createRole: vi.fn(() => of({ ...CUSTOM, id: 101 })),
      updateRole: vi.fn(() => of(CUSTOM)),
      duplicateRole: vi.fn(() => of({ ...CUSTOM, id: 102 })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RoleService, useValue: service },
        { provide: AlertService, useValue: alert },
        { provide: AuthService, useValue: { can: vi.fn(opts.held ?? (() => true)) } },
        { provide: ModalStackService, useValue: { push: vi.fn(() => 1), remove: vi.fn() } },
        { provide: ActivatedRoute, useValue: stubRoute(opts.id ? { id: opts.id } : {}) },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(RoleEditorComponent);
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  const perm = (key: string) => c.groups.flatMap((g: { permissions: { key: string }[] }) => g.permissions).find((p: { key: string }) => p.key === key);

  beforeEach(() => vi.restoreAllMocks());

  it('groups every catalog permission by area', () => {
    setup();
    const total = c.groups.reduce((n: number, g: { permissions: unknown[] }) => n + g.permissions.length, 0);
    expect(total).toBe(c.totalPermissions);
    expect(c.groups.map((g: { area: string }) => g.area)).toContain('Orders');
  });

  it('checking a permission also checks what it needs, and unchecking removes what depends on it', () => {
    setup();
    c.togglePermission(perm('orders.override'));
    expect([...c.selected()].sort()).toEqual(['orders.override', 'orders.read', 'orders.write']);

    c.togglePermission(perm('orders.read'));
    expect([...c.selected()]).toEqual([]);
    expect(c.roleForm.dirty).toBe(true);
  });

  it('summarizes what the role can open and change', () => {
    setup();
    c.togglePermission(perm('orders.write'));
    c.togglePermission(perm('expenses.read'));
    expect(c.summary()).toEqual({ open: ['Orders', 'Money'], change: ['Orders'] });
  });

  it('does not let you give a permission you do not hold', () => {
    setup({ held: (key) => key !== 'audit.read' });
    expect(c.isDisabled(perm('audit.read'))).toBe(true);
    c.togglePermission(perm('audit.read'));
    expect(c.selected().has('audit.read')).toBe(false);
    expect(c.isDisabled(perm('orders.read'))).toBe(false);
  });

  it('greys out permissions outside the plan with the plan name, and keeps them on the role', () => {
    const plans: PermissionPlanDto[] = [
      { key: 'stock.read', feature: 'inventory', inPlan: false, availableInPlans: ['Pro'] },
      { key: 'stock.write', feature: 'inventory', inPlan: false, availableInPlans: ['Pro'] },
      { key: 'orders.read', feature: 'core', inPlan: true, availableInPlans: ['Starter', 'Pro'] },
    ];
    const role = { ...CUSTOM, permissions: ['orders.read', 'stock.read', 'stock.write'] };
    setup({ id: '100', role, plans, held: (key) => !key.startsWith('stock.') });

    expect(c.isOutsidePlan(perm('stock.write'))).toBe(true);
    expect(c.isDisabled(perm('stock.write'))).toBe(true);
    expect(c.planLabel(perm('stock.write'))).toBe('Not in your plan. Available in Pro.');
    expect(c.isOutsidePlan(perm('orders.read'))).toBe(false);

    c.togglePermission(perm('stock.write'));
    expect(c.selected().has('stock.write')).toBe(true);

    // The role is still editable: keys the plan switches off are not "permissions you lack".
    expect(c.cannotEditRole()).toBe(false);
    expect(c.isReadOnly()).toBe(false);
  });

  it('creates a role and goes back to the list', () => {
    setup();
    c.roleForm.patchValue({ name: ' Lead ', description: '' });
    c.togglePermission(perm('orders.write'));

    c.save();

    expect(service['createRole']).toHaveBeenCalledWith({
      name: 'Lead',
      description: null,
      permissions: ['orders.write', 'orders.read'],
    });
    expect(alert.successCreated).toHaveBeenCalledWith('Role');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/management/roles');
  });

  it('does not save without a name', () => {
    setup();
    c.save();
    expect(service['createRole']).not.toHaveBeenCalled();
    expect(c.roleForm.controls.name.touched).toBe(true);
  });

  it('shows the server message when saving fails', () => {
    setup();
    service['createRole'].mockReturnValue(throwError(() => new Error('A role with that name already exists.')));
    c.roleForm.patchValue({ name: 'Lead' });
    c.save();
    expect(alert.error).toHaveBeenCalledWith('A role with that name already exists.');
    expect(c.isSaving()).toBe(false);
  });

  it('loads a custom role for editing and updates it', () => {
    setup({ id: '100', role: CUSTOM });
    expect(c.roleForm.controls.name.value).toBe('Shift Lead');
    expect([...c.selected()].sort()).toEqual(['orders.read', 'orders.write']);
    expect(c.isReadOnly()).toBe(false);

    c.save();
    expect(service['updateRole']).toHaveBeenCalledWith(100, {
      name: 'Shift Lead',
      description: 'Runs the floor',
      permissions: ['orders.read', 'orders.write'],
    });
    expect(alert.successUpdated).toHaveBeenCalledWith('Role');
  });

  it('opens a built-in role read-only and duplicates it instead', () => {
    setup({ id: '2', role: SYSTEM });
    expect(c.isReadOnly()).toBe(true);
    expect(c.roleForm.disabled).toBe(true);

    c.togglePermission(perm('orders.override'));
    expect(c.selected().has('orders.override')).toBe(false);

    c.save();
    expect(service['updateRole']).not.toHaveBeenCalled();

    c.duplicate();
    expect(service['duplicateRole']).toHaveBeenCalledWith(2);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/management/roles/102');
  });

  it('opens a role with permissions you lack as view only', () => {
    setup({ id: '100', role: CUSTOM, held: (key) => key !== 'orders.write' });
    expect(c.cannotEditRole()).toBe(true);
    expect(c.isReadOnly()).toBe(true);
  });

  it('goes back to the list when the role cannot be loaded', () => {
    setup({ id: '100' });
    expect(alert.error).toHaveBeenCalledWith('gone');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/management/roles');
  });

  it('asks before leaving with unsaved changes', async () => {
    setup();
    expect(c.canDeactivate()).toBe(true);

    c.togglePermission(perm('orders.read'));
    const pending = c.canDeactivate() as Promise<boolean>;
    expect(c.showDiscardModal()).toBe(true);
    c.confirmDiscard();
    expect(await pending).toBe(true);
  });
});
