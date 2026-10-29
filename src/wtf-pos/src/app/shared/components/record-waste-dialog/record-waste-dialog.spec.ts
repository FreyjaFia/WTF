import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WasteReasonService } from '@core/services/waste-reason.service';
import { StockWasteSource, WasteReasonDto } from '@shared/models';
import { Observable, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { RecordWasteDialogComponent, WasteItem } from './record-waste-dialog';

const reasons: WasteReasonDto[] = [
  { id: 3, name: 'Other', requiresNote: true, sortOrder: 9, isActive: true, isSystem: false },
  { id: 1, name: 'Spilled', requiresNote: false, sortOrder: 1, isActive: true, isSystem: false },
  { id: 2, name: 'Old reason', requiresNote: false, sortOrder: 0, isActive: false, isSystem: false },
  { id: 4, name: 'Expired', requiresNote: false, sortOrder: 1, isActive: true, isSystem: false },
];

const baseItem: WasteItem = {
  id: 'i1',
  name: 'Oat Milk',
  unitName: 'ml',
  currentQuantity: 10,
  allowNegativeStock: true,
  wasteApprovalLimit: null,
};

describe('RecordWasteDialogComponent', () => {
  let fixture: ComponentFixture<RecordWasteDialogComponent>;

  function setup(
    options: {
      item?: Partial<WasteItem>;
      reasons$?: Observable<WasteReasonDto[]>;
      busy?: boolean;
      source?: StockWasteSource;
    } = {},
  ) {
    const getReasons = vi.fn(() => options.reasons$ ?? of(reasons));
    TestBed.configureTestingModule({
      providers: [{ provide: WasteReasonService, useValue: { getReasons } }],
    });
    fixture = TestBed.createComponent(RecordWasteDialogComponent);
    fixture.componentRef.setInput('item', { ...baseItem, ...options.item });
    if (options.busy !== undefined) {
      fixture.componentRef.setInput('isBusy', options.busy);
    }
    if (options.source !== undefined) {
      fixture.componentRef.setInput('source', options.source);
    }
    fixture.detectChanges();
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    return { confirmed, cancelled, getReasons };
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const testId = (id: string) => el().querySelector(`[data-testid="${id}"]`);
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
  const options = () =>
    [...el().querySelectorAll('#waste-reason option')].map((o) => o.textContent?.trim());

  function typeQuantity(value: string) {
    const input = el().querySelector('#waste-quantity') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function chooseReason(id: number) {
    const select = el().querySelector('#waste-reason') as HTMLSelectElement;
    select.value = String(id);
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function typeNote(value: string) {
    const textarea = el().querySelector('#waste-notes') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function save() {
    button('Record Waste').click();
    fixture.detectChanges();
  }

  it('lists only active reasons, by sort order then name', () => {
    setup();
    expect(options()).toEqual(['Choose a reason', 'Expired', 'Spilled', 'Other']);
  });

  it('shows the reason load error', () => {
    const reasons$ = new Subject<WasteReasonDto[]>();
    setup({ reasons$ });
    reasons$.error(new Error('Unable to fetch the waste reasons.'));
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Unable to fetch the waste reasons.');
    expect(options()).toEqual(['Choose a reason']);
  });

  it('shows the balance after the waste as the user types', () => {
    setup();
    expect(testId('waste-balance')?.textContent).toContain('Now 10 ml');
    typeQuantity('4');
    expect(testId('waste-balance')?.textContent).toContain('after 6 ml');
  });

  it('asks for a quantity above zero', () => {
    const { confirmed } = setup();
    chooseReason(1);
    typeQuantity('0');
    save();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Enter how much was wasted.');

    typeQuantity('-2');
    save();
    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Enter how much was wasted.');
  });

  it('refuses a quantity that is too large', () => {
    const { confirmed } = setup();
    chooseReason(1);
    typeQuantity('1000000');
    save();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('The quantity is too large.');
  });

  it('asks for a reason', () => {
    const { confirmed } = setup();
    typeQuantity('2');
    save();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Choose a reason.');
  });

  it('needs a note when the reason requires one', () => {
    const { confirmed } = setup();
    typeQuantity('2');
    chooseReason(3);
    expect(el().textContent).toContain('Note (required)');
    typeNote('   ');
    save();

    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('A note is required when the reason is Other.');

    typeNote(' dropped tray ');
    save();
    expect(confirmed).toHaveBeenCalledWith({
      itemId: 'i1',
      quantity: 2,
      wasteReasonId: 3,
      notes: 'dropped tray',
      source: StockWasteSource.ItemDetails,
      clientRequestId: expect.any(String),
    });
  });

  it('sends a null note when an optional note is left empty, with the given source', () => {
    const { confirmed } = setup({ source: StockWasteSource.Pos });
    typeQuantity('2.5');
    chooseReason(1);
    expect(el().textContent).toContain('Note (optional)');
    save();

    expect(confirmed).toHaveBeenCalledWith({
      itemId: 'i1',
      quantity: 2.5,
      wasteReasonId: 1,
      notes: null,
      source: StockWasteSource.Pos,
      clientRequestId: expect.any(String),
    });
  });

  it('reuses the same client request id when the save is retried', () => {
    const { confirmed } = setup();
    typeQuantity('1');
    chooseReason(1);
    save();
    save();

    const first = confirmed.mock.calls[0][0].clientRequestId as string;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(confirmed.mock.calls[1][0].clientRequestId).toBe(first);
  });

  it('clears the error when the user edits', () => {
    setup();
    save();
    expect(el().querySelector('[role="alert"]')).not.toBeNull();
    typeQuantity('1');
    expect(el().querySelector('[role="alert"]')).toBeNull();
  });

  it('warns but allows a warn-only item to go below zero', () => {
    const { confirmed } = setup();
    typeQuantity('12');
    chooseReason(1);

    expect(testId('waste-below-zero')).not.toBeNull();
    expect(testId('waste-blocked')).toBeNull();
    save();
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ quantity: 12 }));
  });

  it('blocks a blocking item from going below zero', () => {
    const { confirmed } = setup({ item: { allowNegativeStock: false } });
    typeQuantity('12');
    chooseReason(1);

    expect(testId('waste-blocked')).not.toBeNull();
    expect(testId('waste-below-zero')).toBeNull();
    save();
    expect(confirmed).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Oat Milk does not allow sales below zero');
  });

  it('lets a blocking item waste exactly its balance', () => {
    const { confirmed } = setup({ item: { allowNegativeStock: false } });
    typeQuantity('10');
    chooseReason(1);

    expect(testId('waste-blocked')).toBeNull();
    save();
    expect(confirmed).toHaveBeenCalled();
  });

  it('warns that an Admin must review a quantity above the approval limit', () => {
    const { confirmed } = setup({ item: { wasteApprovalLimit: 5 } });
    typeQuantity('5');
    expect(testId('waste-needs-review')).toBeNull();

    typeQuantity('6');
    expect(testId('waste-needs-review')?.textContent).toContain('approval limit (5 ml)');
    chooseReason(1);
    save();
    expect(confirmed).toHaveBeenCalled();
  });

  it('never warns about review when the item has no limit', () => {
    setup();
    typeQuantity('9999');
    expect(testId('waste-needs-review')).toBeNull();
    expect(testId('waste-limit-hint')).toBeNull();
  });

  it('tells the person the approval limit before they go over it', () => {
    setup({ item: { wasteApprovalLimit: 5 } });
    typeQuantity('2');
    expect(testId('waste-limit-hint')?.textContent).toContain('above 5 ml is sent to an Admin');

    typeQuantity('6');
    expect(testId('waste-limit-hint')).toBeNull();
  });

  it('shows the busy label and does not submit while busy', () => {
    const { confirmed } = setup({ busy: true });
    typeQuantity('2');
    chooseReason(1);

    expect(el().textContent).toContain('Saving...');
    (fixture.componentInstance as unknown as { submit(): void }).submit();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('cancels', () => {
    const { cancelled } = setup();
    button('Cancel').click();
    expect(cancelled).toHaveBeenCalled();
  });
});
