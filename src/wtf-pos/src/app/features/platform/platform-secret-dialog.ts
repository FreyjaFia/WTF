import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface PlatformSecret {
  title: string;
  username: string;
  password: string;
}

@Component({
  selector: 'app-platform-secret-dialog',
  template: `
    <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md" role="dialog" aria-modal="true">
      <div class="app-dialog mx-4 w-full max-w-md animate-[modal-pop_0.2s_ease-out] rounded-2xl bg-surface p-6 shadow-2xl">
        <h2 class="mb-2 text-base font-semibold">{{ secret().title }}</h2>
        <p class="mb-3 text-sm text-gray-600">
          Give this to the owner now. It is shown once, and they must choose a new password when they sign in.
        </p>
        <dl class="rounded-lg bg-gray-50 p-3 text-sm">
          <dt class="text-gray-500">Username</dt>
          <dd class="mb-2 font-mono" data-testid="secret-username">{{ secret().username }}</dd>
          <dt class="text-gray-500">One-time password</dt>
          <dd class="font-mono" data-testid="secret-password">{{ secret().password }}</dd>
        </dl>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="app-btn app-btn-secondary app-btn-md" (click)="copy()">Copy</button>
          <button type="button" class="app-btn app-btn-primary app-btn-md" (click)="closed.emit()">Done</button>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformSecretDialogComponent {
  public readonly secret = input.required<PlatformSecret>();
  public readonly closed = output<void>();

  protected copy(): void {
    const s = this.secret();

    navigator.clipboard?.writeText(`Username: ${s.username}\nOne-time password: ${s.password}`).catch(() => undefined);
  }
}
