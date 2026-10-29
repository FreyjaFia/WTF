import { TestBed } from '@angular/core/testing';
import { AlertService, ModalStackService, WasteReasonService } from '@core/services';
import { WasteReasonDto } from '@shared/models';
import { fakeAlert, internals } from '@app/testing/management-spec-helpers';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WasteReasonsComponent } from './waste-reasons';

function reason(overrides: Partial<WasteReasonDto> = {}): WasteReasonDto {
  return {
    id: 1,
    name: 'Spilled',
    requiresNote: false,
    sortOrder: 10,
    isActive: true,
    isSystem: false,
    ...overrides,
  };
}

const REASONS: WasteReasonDto[] = [
  reason({ id: 1, name: 'Spilled', sortOrder: 20 }),
  reason({ id: 2, name: 'Expired', sortOrder: 10 }),
  reason({ id: 3, name: 'Other', sortOrder: 5, isSystem: true, requiresNote: true }),
  reason({ id: 4, name: 'Old reason', sortOrder: 1, isActive: false }),
];

describe('WasteReasonsComponent', () => {
  let service: {
    getReasons: ReturnType<typeof vi.fn>;
    createReason: ReturnType<typeof vi.fn>;
    updateReason: ReturnType<typeof vi.fn>;
    deactivateReason: ReturnType<typeof vi.fn>;
    restoreReason: ReturnType<typeof vi.fn>;
  };
  let alerts: ReturnType<typeof fakeAlert>;
  let modalStack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: WasteReasonService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: modalStack },
      ],
    });
    const fixture = TestBed.createComponent(WasteReasonsComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function buttons(fixture: { nativeElement: HTMLElement }, label: string): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button')).filter(
      (b) => (b as HTMLButtonElement).textContent?.trim() === label,
    ) as HTMLButtonElement[];
  }

  beforeEach(() => {
    service = {
      getReasons: vi.fn(() => of(REASONS)),
      createReason: vi.fn(),
      updateReason: vi.fn(),
      deactivateReason: vi.fn(),
      restoreReason: vi.fn(),
    };
    alerts = fakeAlert();
    modalStack = { push: vi.fn(() => 7), remove: vi.fn() };
  });

  it('loads every reason, including inactive ones, on init', () => {
    const fixture = create();
    expect(service.getReasons).toHaveBeenCalledWith(true);
    expect(text(fixture)).toContain('Spilled');
    expect(text(fixture)).toContain('Old reason');
  });

  it('sorts active reasons first, then by sort order', () => {
    const fixture = create();
    const names = internals(fixture.componentInstance)
      .sortedReasons()
      .map((r: WasteReasonDto) => r.name);
    expect(names).toEqual(['Other', 'Expired', 'Spilled', 'Old reason']);
  });

  it('shows the built-in and note-required badges', () => {
    const fixture = create();
    expect(text(fixture)).toContain('Built-in');
    expect(text(fixture)).toContain('Note required');
  });

  it('offers Turn Off only for active custom reasons and Restore only for inactive ones', () => {
    const fixture = create();
    expect(buttons(fixture, 'Turn Off')).toHaveLength(2);
    expect(buttons(fixture, 'Restore')).toHaveLength(1);
    expect(buttons(fixture, 'Edit')).toHaveLength(4);
  });

  it('shows the empty state when there are no reasons', () => {
    service.getReasons.mockReturnValue(of([]));
    const fixture = create();
    expect(text(fixture)).toContain('No waste reasons yet.');
  });

  it('shows a spinner while loading', () => {
    const pending = new Subject<WasteReasonDto[]>();
    service.getReasons.mockReturnValue(pending);
    const fixture = create();
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).not.toBeNull();
    pending.next(REASONS);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).toBeNull();
  });

  it('alerts when loading fails', () => {
    const pending = new Subject<WasteReasonDto[]>();
    service.getReasons.mockReturnValue(pending);
    const fixture = create();
    pending.error(new Error('load failed'));
    fixture.detectChanges();
    expect(alerts.error).toHaveBeenCalledWith('load failed');
    expect(internals(fixture.componentInstance).isLoading()).toBe(false);
  });

  it('opens Add with the next sort order and an editable note toggle', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    fixture.detectChanges();
    expect(c.dialog()).toBe('edit');
    expect(c.selected()).toBeNull();
    expect(c.form.getRawValue()).toEqual({ name: '', requiresNote: false, sortOrder: 30 });
    expect(c.form.controls.requiresNote.enabled).toBe(true);
    expect(modalStack.push).toHaveBeenCalled();
    expect(text(fixture)).toContain('Add Waste Reason');
  });

  it('locks the note toggle when editing a built-in reason that needs a note', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openEdit(REASONS[2]);
    fixture.detectChanges();
    expect(c.form.controls.requiresNote.disabled).toBe(true);
    expect(c.form.getRawValue().requiresNote).toBe(true);
    expect(text(fixture)).toContain('This built-in reason always needs a note.');
  });

  it('keeps the note toggle editable for a custom reason', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openEdit(REASONS[0]);
    expect(c.form.controls.requiresNote.enabled).toBe(true);
    expect(c.form.getRawValue().name).toBe('Spilled');
  });

  it('refuses a blank name without calling the API', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.controls.name.setValue('   ');
    c.saveReason();
    expect(c.formError()).toBe('Enter a name of up to 60 characters and a sort order of 0 or more.');
    expect(service.createReason).not.toHaveBeenCalled();
  });

  it('refuses a negative sort order', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.patchValue({ name: 'Burnt', sortOrder: -1 });
    c.saveReason();
    expect(c.formError()).not.toBeNull();
    expect(service.createReason).not.toHaveBeenCalled();
  });

  it('creates a reason with a trimmed name and closes the dialog', () => {
    const created = reason({ id: 9, name: 'Burnt', sortOrder: 30, requiresNote: true });
    const pending = new Subject<WasteReasonDto>();
    service.createReason.mockReturnValue(pending);
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.patchValue({ name: '  Burnt  ', requiresNote: true });
    c.saveReason();

    expect(service.createReason).toHaveBeenCalledWith({
      name: 'Burnt',
      requiresNote: true,
      sortOrder: 30,
    });
    expect(c.isSaving()).toBe(true);
    fixture.detectChanges();
    expect(text(fixture)).toContain('Saving...');

    pending.next(created);
    fixture.detectChanges();
    expect(c.isSaving()).toBe(false);
    expect(alerts.success).toHaveBeenCalledWith('Waste reason added.');
    expect(c.dialog()).toBeNull();
    expect(c.reasons().some((r: WasteReasonDto) => r.id === 9)).toBe(true);
    expect(modalStack.remove).toHaveBeenCalledWith(7);
  });

  it('updates an existing reason in place, keeping the locked note flag', () => {
    const saved = { ...REASONS[2], name: 'Other (see note)' };
    service.updateReason.mockReturnValue(of(saved));
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openEdit(REASONS[2]);
    c.form.controls.name.setValue('Other (see note)');
    c.saveReason();

    expect(service.updateReason).toHaveBeenCalledWith(3, {
      name: 'Other (see note)',
      requiresNote: true,
      sortOrder: 5,
    });
    expect(alerts.success).toHaveBeenCalledWith('Waste reason saved.');
    expect(c.reasons()).toHaveLength(4);
    expect(c.reasons().find((r: WasteReasonDto) => r.id === 3).name).toBe('Other (see note)');
  });

  it('shows the server error in the dialog and keeps it open', () => {
    const pending = new Subject<WasteReasonDto>();
    service.createReason.mockReturnValue(pending);
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.controls.name.setValue('Spilled');
    c.saveReason();
    pending.error(new Error('A reason with that name already exists.'));
    fixture.detectChanges();
    expect(c.isSaving()).toBe(false);
    expect(c.dialog()).toBe('edit');
    expect(text(fixture)).toContain('A reason with that name already exists.');
  });

  it('does not close the dialog while saving', () => {
    service.createReason.mockReturnValue(new Subject<WasteReasonDto>());
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openAdd();
    c.form.controls.name.setValue('Burnt');
    c.saveReason();
    c.closeDialog();
    expect(c.dialog()).toBe('edit');
  });

  it('turns a reason off and reports it', () => {
    const pending = new Subject<WasteReasonDto>();
    service.deactivateReason.mockReturnValue(pending);
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openDeactivate(REASONS[0]);
    fixture.detectChanges();
    expect(text(fixture)).toContain('Turn Off Reason');
    c.confirmDeactivate();
    expect(service.deactivateReason).toHaveBeenCalledWith(1);
    fixture.detectChanges();
    expect(text(fixture)).toContain('Turning off...');

    pending.next({ ...REASONS[0], isActive: false });
    fixture.detectChanges();
    expect(alerts.success).toHaveBeenCalledWith('Spilled is turned off.');
    expect(c.dialog()).toBeNull();
    expect(c.reasons().find((r: WasteReasonDto) => r.id === 1).isActive).toBe(false);
  });

  it('alerts when turning off fails', () => {
    const pending = new Subject<WasteReasonDto>();
    service.deactivateReason.mockReturnValue(pending);
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openDeactivate(REASONS[0]);
    c.confirmDeactivate();
    pending.error(new Error('nope'));
    expect(alerts.error).toHaveBeenCalledWith('nope');
    expect(c.isSaving()).toBe(false);
  });

  it('restores an inactive reason', () => {
    const pending = new Subject<WasteReasonDto>();
    service.restoreReason.mockReturnValue(pending);
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openRestore(REASONS[3]);
    c.confirmRestore();
    expect(service.restoreReason).toHaveBeenCalledWith(4);
    fixture.detectChanges();
    expect(text(fixture)).toContain('Restoring...');

    pending.next({ ...REASONS[3], isActive: true });
    expect(alerts.success).toHaveBeenCalledWith('Old reason is restored.');
    expect(c.reasons().find((r: WasteReasonDto) => r.id === 4).isActive).toBe(true);
  });

  it('alerts when restoring fails', () => {
    const pending = new Subject<WasteReasonDto>();
    service.restoreReason.mockReturnValue(pending);
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.openRestore(REASONS[3]);
    c.confirmRestore();
    pending.error(new Error('restore failed'));
    expect(alerts.error).toHaveBeenCalledWith('restore failed');
  });

  it('does nothing on confirm when no reason is selected', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    c.confirmDeactivate();
    c.confirmRestore();
    expect(service.deactivateReason).not.toHaveBeenCalled();
    expect(service.restoreReason).not.toHaveBeenCalled();
  });

  it('reloads without the full spinner on refresh', () => {
    const fixture = create();
    const c = internals(fixture.componentInstance);
    const pending = new Subject<WasteReasonDto[]>();
    service.getReasons.mockReturnValue(pending);
    c.refresh();
    expect(c.isRefreshing()).toBe(true);
    expect(c.isLoading()).toBe(false);
    pending.next(REASONS);
    expect(c.isRefreshing()).toBe(false);
    expect(service.getReasons).toHaveBeenCalledTimes(2);
  });

  it('removes its modal from the stack when destroyed', () => {
    const fixture = create();
    internals(fixture.componentInstance).openAdd();
    fixture.destroy();
    expect(modalStack.remove).toHaveBeenCalledWith(7);
  });
});
