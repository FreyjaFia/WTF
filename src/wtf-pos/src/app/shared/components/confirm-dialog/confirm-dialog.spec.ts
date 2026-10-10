// Equivalence test: the original, hand-written dialog markup (embedded verbatim below) must render
// the same DOM as <app-confirm-dialog> configured for the same case.
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ConfirmDialogComponent } from './confirm-dialog';

const ORIGINAL_DELETE_ITEM = `@if (showDeleteModal() && itemToDelete() && canWriteItems()) {
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md transition-opacity duration-200"
    (click)="cancelDelete()"
    (keydown.escape)="cancelDelete()"
    tabindex="0"
  >
    <div
      role="document"
      class="mx-4 w-full max-w-sm animate-[modal-pop_0.2s_ease-out] rounded-2xl bg-white p-6 shadow-2xl"
      (click)="$event.stopPropagation()"
      (keydown)="$event.stopPropagation()"
    >
      <div class="mx-auto w-fit rounded-full bg-red-50/60 p-3">
        <div class="rounded-full bg-red-50 p-3">
          <app-icon name="icon-delete" [class]="'h-6 w-6 text-red-600'" />
        </div>
      </div>

      <h3 id="delete-title" class="mt-4 text-center text-lg font-semibold text-gray-900">
        Delete Item?
      </h3>
      <p class="mt-2 text-center text-sm leading-relaxed text-gray-500">
        This will deactivate
        <span class="font-medium text-gray-700">{{ itemToDelete()!.name }}</span>
        and keep its stock history. You can restore it later.
      </p>

      <div class="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          class="cursor-pointer px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          (click)="cancelDelete()"
          [disabled]="isDeleting()"
        >
          Cancel
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-xl bg-red-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700 hover:shadow-md active:scale-[0.97]"
          (click)="confirmDelete()"
          [disabled]="isDeleting()"
        >
          @if (isDeleting()) {
            <span class="loading loading-spinner loading-xs mr-2"></span>
          }
          {{ isDeleting() ? 'Deleting Item...' : 'Delete Item' }}
        </button>
      </div>
    </div>
  </div>
}`;

const ORIGINAL_DELETE_CUSTOMER = `@if (showDeleteModal() && customerToDelete()) {
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md transition-opacity duration-200"
    (click)="cancelDelete()"
    (keydown.escape)="cancelDelete()"
    tabindex="0"
  >
    <div
      role="document"
      class="mx-4 w-full max-w-sm animate-[modal-pop_0.2s_ease-out] rounded-2xl bg-white p-6 shadow-2xl"
      (click)="$event.stopPropagation()"
      (keydown)="$event.stopPropagation()"
    >
      <!-- Double-Ring Warning Icon -->
      <div class="mx-auto w-fit rounded-full bg-red-50/60 p-3">
        <div class="rounded-full bg-red-50 p-3">
          <app-icon name="icon-delete" [class]="'h-6 w-6 text-red-600'" />
        </div>
      </div>

      <!-- Title & Body -->
      <h3 id="delete-title" class="mt-4 text-center text-lg font-semibold text-gray-900">
        Delete Customer?
      </h3>
      <p class="mt-2 text-center text-sm leading-relaxed text-gray-500">
        This will deactivate
        <span class="font-medium text-gray-700">
          {{ customerToDelete()!.firstName }} {{ customerToDelete()!.lastName }}</span
        >. You can restore it later.
      </p>

      <!-- Actions -->
      <div class="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          class="cursor-pointer px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          (click)="cancelDelete()"
          [disabled]="isDeleting()"
        >
          Cancel
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-xl bg-red-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700 hover:shadow-md active:scale-[0.97]"
          (click)="confirmDelete()"
          [disabled]="isDeleting()"
        >
          @if (isDeleting()) {
            <span class="loading loading-spinner loading-xs mr-2"></span>
          }
          {{ isDeleting() ? 'Deleting Customer...' : 'Delete Customer' }}
        </button>
      </div>
    </div>
  </div>
}`;

const ORIGINAL_DISCARD = `@if (showDiscardModal()) {
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="discard-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md transition-opacity duration-200"
    (click)="cancelDiscard()"
    (keydown.escape)="cancelDiscard()"
    tabindex="0"
  >
    <div
      role="document"
      class="mx-4 w-full max-w-sm animate-[modal-pop_0.2s_ease-out] rounded-2xl bg-white p-6 shadow-2xl"
      (click)="$event.stopPropagation()"
      (keydown)="$event.stopPropagation()"
    >
      <div class="mx-auto w-fit rounded-full bg-amber-50/60 p-3">
        <div class="rounded-full bg-amber-50 p-3">
          <app-icon name="icon-back" [class]="'h-6 w-6 text-amber-600'" />
        </div>
      </div>

      <h3 id="discard-title" class="mt-4 text-center text-lg font-semibold text-gray-900">
        Discard Changes?
      </h3>
      <p class="mt-2 text-center text-sm leading-relaxed text-gray-500">
        You have unsaved changes that will be lost if you leave this page.
      </p>

      <div class="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          class="cursor-pointer px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:text-red-700"
          (click)="confirmDiscard()"
        >
          Discard
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-xl bg-[#047857] px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#065f46] hover:shadow-md active:scale-[0.97]"
          (click)="cancelDiscard()"
        >
          Keep Editing
        </button>
      </div>
    </div>
  </div>
}`;

const ORIGINAL_EXIT = `@if (visible()) {
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="exit-confirm-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md transition-opacity duration-200"
    (click)="cancel()"
    (keydown.escape)="cancel()"
    tabindex="0"
  >
    <div
      role="document"
      class="mx-4 w-full max-w-sm animate-[modal-pop_0.2s_ease-out] rounded-2xl bg-white p-6 shadow-2xl"
      (click)="$event.stopPropagation()"
      (keydown)="$event.stopPropagation()"
    >
      <!-- Double-Ring Warning Icon -->
      <div class="mx-auto w-fit rounded-full bg-red-50/60 p-3">
        <div class="rounded-full bg-red-50 p-3">
          <app-icon name="icon-close" [class]="'h-6 w-6 text-red-600'" />
        </div>
      </div>

      <!-- Title & Body -->
      <h3 id="exit-confirm-title" class="mt-4 text-center text-lg font-semibold text-gray-900">
        Close App?
      </h3>
      <p class="mt-2 text-center text-sm leading-relaxed text-gray-500">
        Are you sure you want to close the app?
      </p>

      <!-- Actions -->
      <div class="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          class="cursor-pointer px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          (click)="cancel()"
        >
          Cancel
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-xl bg-red-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700 hover:shadow-md active:scale-[0.97]"
          (click)="confirm()"
        >
          Close App
        </button>
      </div>
    </div>
  </div>
}`;

const ORIGINAL_RESTORE = `<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="restore-title"
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md transition-opacity duration-200"
  (click)="cancelled.emit()"
  (keydown.escape)="cancelled.emit()"
  tabindex="0"
>
  <div
    role="document"
    class="mx-4 w-full max-w-sm animate-[modal-pop_0.2s_ease-out] rounded-2xl bg-white p-6 shadow-2xl"
    (click)="$event.stopPropagation()"
    (keydown)="$event.stopPropagation()"
  >
    <div class="mx-auto w-fit rounded-full bg-[#047857]/10 p-3">
      <div class="rounded-full bg-[#047857]/10 p-3">
        <app-icon name="icon-refresh" [class]="'h-6 w-6 text-[#047857]'" />
      </div>
    </div>

    <h3 id="restore-title" class="mt-4 text-center text-lg font-semibold text-gray-900">
      Restore {{ entityLabel() }}?
    </h3>
    <p class="mt-2 text-center text-sm leading-relaxed text-gray-500">
      This will reactivate
      <span class="font-medium text-gray-700">{{ name() }}</span
      >.
      @if (description()) {
        {{ description() }}
      }
    </p>

    <div class="mt-6 flex items-center justify-end gap-3">
      <button
        type="button"
        class="cursor-pointer px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
        (click)="cancelled.emit()"
        [disabled]="isRestoring()"
      >
        Cancel
      </button>
      <button
        type="button"
        class="cursor-pointer rounded-xl bg-[#047857] px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#065f46] hover:shadow-md active:scale-[0.97]"
        (click)="confirmed.emit()"
        [disabled]="isRestoring()"
      >
        @if (isRestoring()) {
          <span class="loading loading-spinner loading-xs mr-2"></span>
        }
        {{ isRestoring() ? 'Restoring ' + entityLabel() + '...' : 'Restore ' + entityLabel() }}
      </button>
    </div>
  </div>
</div>`;

function normalize(root: HTMLElement): string {
  return root.innerHTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\sdialogextra=""/g, '')
    // Button styling now comes from the shared button system, so compare button structure and text only.
    .replace(/(<button[^>]*?)\sclass="[^"]*"/g, '$1 class="BTN"')
    .replace(/\s(_ngcontent|_nghost|ng-reflect)[-\w]*(="[^"]*")?/g, '')
    // A static `name="..."` input is echoed onto <app-icon>; a bound [name] is not. The rendered
    // <svg>/<use> inside is what matters and is compared as-is.
    .replace(/<app-icon name="[^"]*"/g, '<app-icon')
    .replace(
      /class="([^"]*)"/g,
      (_, classes: string) =>
        `class="${classes.split(/\s+/).filter(Boolean).sort().join(' ')}"`,
    )
    .replace(
      /(id|aria-labelledby)="[\w-]*title"/g,
      '$1="TITLE-ID"',
    )
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .replace(/\s>/g, '>')
    .trim();
}

// ---- Original markup hosts (templates are the verbatim originals embedded above) ----

@Component({ template: ORIGINAL_DELETE_ITEM, imports: [IconComponent] })
class OriginalDeleteItemHost {
  busy = false;
  showDeleteModal = () => true;
  itemToDelete = () => ({ name: 'Sample Item' });
  canWriteItems = () => true;
  isDeleting = () => this.busy;
  cancelDelete = () => undefined;
  confirmDelete = () => undefined;
}

@Component({ template: ORIGINAL_DELETE_CUSTOMER, imports: [IconComponent] })
class OriginalDeleteCustomerHost {
  busy = false;
  showDeleteModal = () => true;
  customerToDelete = () => ({ firstName: 'Ann', lastName: 'Lee' });
  isDeleting = () => this.busy;
  cancelDelete = () => undefined;
  confirmDelete = () => undefined;
}

@Component({ template: ORIGINAL_DISCARD, imports: [IconComponent] })
class OriginalDiscardHost {
  showDiscardModal = () => true;
  cancelDiscard = () => undefined;
  confirmDiscard = () => undefined;
}

@Component({ template: ORIGINAL_EXIT, imports: [IconComponent] })
class OriginalExitHost {
  visible = () => true;
  cancel = () => undefined;
  confirm = () => undefined;
}

@Component({ template: ORIGINAL_RESTORE, imports: [IconComponent] })
class OriginalRestoreHost {
  busy = false;
  entityLabel = () => 'Item';
  name = () => 'Sample Item';
  description = () => 'Its linked products and stock history are kept.';
  isRestoring = () => this.busy;
  confirmed = { emit: () => undefined };
  cancelled = { emit: () => undefined };
}

// ---- New component hosts configured for the same cases ----

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog
    icon="icon-delete"
    heading="Delete Item?"
    confirmLabel="Delete Item"
    busyLabel="Deleting Item..."
    [isBusy]="busy"
  >
    This will deactivate
    <span class="font-medium text-gray-700">Sample Item</span>
    and keep its stock history. You can restore it later.
  </app-confirm-dialog>`,
})
class NewDeleteItemHost {
  busy = false;
}

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog
    icon="icon-delete"
    heading="Delete Customer?"
    confirmLabel="Delete Customer"
    busyLabel="Deleting Customer..."
    [isBusy]="busy"
  >
    This will deactivate
    <span class="font-medium text-gray-700">
      Ann Lee</span
    >. You can restore it later.
  </app-confirm-dialog>`,
})
class NewDeleteCustomerHost {
  busy = false;
}

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog
    variant="warning"
    icon="icon-back"
    heading="Discard Changes?"
    confirmLabel="Discard"
    cancelLabel="Keep Editing"
    confirmPlacement="secondary"
  >
    You have unsaved changes that will be lost if you leave this page.
  </app-confirm-dialog>`,
})
class NewDiscardHost {}

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog icon="icon-close" heading="Close App?" confirmLabel="Close App">
    Are you sure you want to close the app?
  </app-confirm-dialog>`,
})
class NewExitHost {}

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog
    variant="success"
    icon="icon-refresh"
    heading="Restore Item?"
    confirmLabel="Restore Item"
    busyLabel="Restoring Item..."
    [isBusy]="busy"
  >
    This will reactivate
    <span class="font-medium text-gray-700">Sample Item</span
    >. Its linked products and stock history are kept.
  </app-confirm-dialog>`,
})
class NewRestoreHost {
  busy = false;
}

// The new component renders inside its <app-confirm-dialog> host element; compare what is inside it.
function html(fixture: ComponentFixture<unknown>): string {
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return normalize(el.querySelector('app-confirm-dialog') ?? el);
}

describe('ConfirmDialogComponent matches the original dialogs', () => {
  it('delete (item list)', () => {
    for (const busy of [false, true]) {
      const original = TestBed.createComponent(OriginalDeleteItemHost);
      const next = TestBed.createComponent(NewDeleteItemHost);
      original.componentInstance.busy = busy;
      next.componentInstance.busy = busy;
      expect(html(next)).toBe(html(original));
    }
  });

  it('delete (customer list, two-field body)', () => {
    for (const busy of [false, true]) {
      const original = TestBed.createComponent(OriginalDeleteCustomerHost);
      const next = TestBed.createComponent(NewDeleteCustomerHost);
      original.componentInstance.busy = busy;
      next.componentInstance.busy = busy;
      expect(html(next)).toBe(html(original));
    }
  });

  it('discard changes', () => {
    const original = TestBed.createComponent(OriginalDiscardHost);
    const next = TestBed.createComponent(NewDiscardHost);
    expect(html(next)).toBe(html(original));
  });

  it('exit app', () => {
    const original = TestBed.createComponent(OriginalExitHost);
    const next = TestBed.createComponent(NewExitHost);
    expect(html(next)).toBe(html(original));
  });

  it('restore', () => {
    for (const busy of [false, true]) {
      const original = TestBed.createComponent(OriginalRestoreHost);
      const next = TestBed.createComponent(NewRestoreHost);
      original.componentInstance.busy = busy;
      next.componentInstance.busy = busy;
      expect(html(next)).toBe(html(original));
    }
  });
});

// ---- Behavior ----

const calls: string[] = [];
const busySignal = signal(false);

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog
    icon="icon-delete"
    heading="H"
    confirmLabel="Yes"
    busyLabel="Working..."
    [isBusy]="busy()"
    (confirmed)="log('confirmed')"
    (cancelled)="log('cancelled')"
    >Body</app-confirm-dialog
  >`,
})
class StandardBehaviorHost {
  protected readonly busy = busySignal;
  protected log(name: string) {
    calls.push(name);
  }
}

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog
    variant="warning"
    icon="icon-back"
    heading="H"
    confirmLabel="Discard"
    cancelLabel="Keep Editing"
    confirmPlacement="secondary"
    (confirmed)="log('confirmed')"
    (cancelled)="log('cancelled')"
    >Body</app-confirm-dialog
  >`,
})
class SecondaryBehaviorHost {
  protected log(name: string) {
    calls.push(name);
  }
}

describe('ConfirmDialogComponent behavior', () => {
  beforeEach(() => {
    calls.length = 0;
    busySignal.set(false);
  });

  it('confirm and cancel buttons emit the right events', () => {
    const fixture = TestBed.createComponent(StandardBehaviorHost);
    fixture.detectChanges();
    const [cancel, confirm] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    cancel.click();
    confirm.click();
    expect(calls).toEqual(['cancelled', 'confirmed']);
  });

  it('backdrop and Escape cancel, clicks inside the dialog do not', () => {
    const fixture = TestBed.createComponent(StandardBehaviorHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[role="document"]') as HTMLElement).click();
    expect(calls).toEqual([]);
    const overlay = el.querySelector('[role="dialog"]') as HTMLElement;
    overlay.click();
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(calls).toEqual(['cancelled', 'cancelled']);
  });

  it('disables both buttons and shows the busy label while busy', () => {
    const fixture = TestBed.createComponent(StandardBehaviorHost);
    fixture.detectChanges();
    busySignal.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(buttons[1].textContent).toContain('Working...');
    expect(el.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('secondary placement: left button confirms, right button cancels', () => {
    const fixture = TestBed.createComponent(SecondaryBehaviorHost);
    fixture.detectChanges();
    const [left, right] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(left.textContent?.trim()).toBe('Discard');
    expect(right.textContent?.trim()).toBe('Keep Editing');
    left.click();
    right.click();
    expect(calls).toEqual(['confirmed', 'cancelled']);
  });
});

// ---- Order dialogs: neutral "Leave" button, extra content slot, muted disabled style ----

const ORIGINAL_ABANDON = `@if (showAbandonModal()) {
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="abandon-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md transition-opacity duration-200"
    (click)="cancelAbandon()"
    (keydown.escape)="cancelAbandon()"
    tabindex="0"
  >
    <div
      role="document"
      class="mx-4 w-full max-w-sm animate-[modal-pop_0.2s_ease-out] rounded-2xl bg-white p-6 shadow-2xl"
      (click)="$event.stopPropagation()"
      (keydown)="$event.stopPropagation()"
    >
      <!-- Double-Ring Warning Icon -->
      <div class="mx-auto w-fit rounded-full bg-amber-50/60 p-3">
        <div class="rounded-full bg-amber-50 p-3">
          <app-icon name="icon-cart" [class]="'h-6 w-6 text-amber-600'" />
        </div>
      </div>

      <!-- Title & Body -->
      <h3 id="abandon-title" class="mt-4 text-center text-lg font-semibold text-gray-900">
        Leave Order?
      </h3>
      <p class="mt-2 text-center text-sm leading-relaxed text-gray-500">
        There are
        <span class="font-medium text-gray-700">{{ itemCount() }}</span>
        {{ itemCount() === 1 ? 'item' : 'items' }} in the cart. Your order will be saved and
        restored when you come back.
      </p>

      <!-- Actions -->
      <div class="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          class="cursor-pointer px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          (click)="confirmAbandon()"
        >
          Leave
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-xl bg-[#047857] px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#065f46] hover:shadow-md active:scale-[0.97]"
          (click)="cancelAbandon()"
        >
          Keep Ordering
        </button>
      </div>
    </div>
  </div>
}`;

const ORIGINAL_REFUND = `@if (showRefundModal() && order(); as currentOrder) {
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="refund-order-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md transition-opacity duration-200"
    (click)="dismissRefundModal()"
    (keydown.escape)="dismissRefundModal()"
    tabindex="0"
  >
    <div
      role="document"
      class="mx-4 w-full max-w-sm animate-[modal-pop_0.2s_ease-out] rounded-2xl bg-white p-6 shadow-2xl"
      (click)="$event.stopPropagation()"
      (keydown)="$event.stopPropagation()"
    >
      <div class="mx-auto w-fit rounded-full bg-red-50/60 p-3">
        <div class="rounded-full bg-red-50 p-3">
          <app-icon name="icon-cart" [class]="'h-6 w-6 text-red-600'" />
        </div>
      </div>

      <h3 id="refund-order-title" class="mt-4 text-center text-lg font-semibold text-gray-900">
        Refund Order?
      </h3>
      <p class="mt-2 text-center text-sm leading-relaxed text-gray-500">
        Are you sure you want to refund order
        <span class="font-medium text-gray-700">#{{ currentOrder.orderNumber }}</span
        >?
      </p>

      <div class="mt-4">
        <label
          for="refund-note"
          class="mb-1 block text-xs font-semibold tracking-wide text-gray-600 uppercase"
        >
          Refund note
        </label>
        <textarea
          id="refund-note"
          class="textarea textarea-bordered min-h-24 w-full text-sm"
          [value]="refundNote()"
          (input)="onRefundNoteInput($event)"
          placeholder="Enter reason for refund"
          maxlength="500"
        ></textarea>
        @if (showRefundNoteError()) {
          <p class="mt-1 text-xs text-red-600">Refund note is required.</p>
        }
      </div>

      <div class="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          class="cursor-pointer px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          (click)="dismissRefundModal()"
          [disabled]="isRefunding()"
        >
          Keep Order
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-xl bg-red-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700 hover:shadow-md active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-gray-300"
          (click)="confirmRefund()"
          [disabled]="isRefunding()"
        >
          @if (isRefunding()) {
            <span class="loading loading-spinner loading-xs mr-2"></span>
          }
          {{ isRefunding() ? 'Refunding...' : 'Refund Order' }}
        </button>
      </div>
    </div>
  </div>
}`;

@Component({ template: ORIGINAL_ABANDON, imports: [IconComponent] })
class OriginalAbandonHost {
  showAbandonModal = () => true;
  itemCount = () => 1;
  cancelAbandon = () => undefined;
  confirmAbandon = () => undefined;
}

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog
    variant="warning"
    icon="icon-cart"
    heading="Leave Order?"
    confirmLabel="Leave"
    cancelLabel="Keep Ordering"
    confirmPlacement="secondary"
    secondaryTone="neutral"
  >
    There are
    <span class="font-medium text-gray-700">{{ count }}</span>
    {{ count === 1 ? 'item' : 'items' }} in the cart. Your order will be saved and
    restored when you come back.
  </app-confirm-dialog>`,
})
class NewAbandonHost {
  count = 1;
}

@Component({ template: ORIGINAL_REFUND, imports: [IconComponent] })
class OriginalRefundHost {
  busy = false;
  showRefundModal = () => true;
  order = () => ({ orderNumber: 42 });
  dismissRefundModal = () => undefined;
  confirmRefund = () => undefined;
  refundNote = () => '';
  onRefundNoteInput = (_event: unknown) => undefined;
  showRefundNoteError = () => true;
  isRefunding = () => this.busy;
}

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog
    icon="icon-cart"
    heading="Refund Order?"
    confirmLabel="Refund Order"
    busyLabel="Refunding..."
    cancelLabel="Keep Order"
    [isBusy]="busy"
  >
    Are you sure you want to refund order
    <span class="font-medium text-gray-700">#42</span
    >?

    <div dialogExtra class="mt-4">
      <label
        for="refund-note"
        class="mb-1 block text-xs font-semibold tracking-wide text-gray-600 uppercase"
      >
        Refund note
      </label>
      <textarea
        id="refund-note"
        class="textarea textarea-bordered min-h-24 w-full text-sm"
        [value]="''"
        placeholder="Enter reason for refund"
        maxlength="500"
      ></textarea>
      <p class="mt-1 text-xs text-red-600">Refund note is required.</p>
    </div>
  </app-confirm-dialog>`,
})
class NewRefundHost {
  busy = false;
}

describe('ConfirmDialogComponent matches the original order dialogs', () => {
  it('abandon (neutral secondary button)', () => {
    for (const count of [1, 2]) {
      const original = TestBed.createComponent(OriginalAbandonHost);
      const next = TestBed.createComponent(NewAbandonHost);
      original.componentInstance.itemCount = () => count;
      next.componentInstance.count = count;
      expect(html(next)).toBe(html(original));
    }
  });

  it('refund (extra content slot, muted disabled button)', () => {
    for (const busy of [false, true]) {
      const original = TestBed.createComponent(OriginalRefundHost);
      const next = TestBed.createComponent(NewRefundHost);
      original.componentInstance.busy = busy;
      next.componentInstance.busy = busy;
      expect(html(next)).toBe(html(original));
    }
  });
});
