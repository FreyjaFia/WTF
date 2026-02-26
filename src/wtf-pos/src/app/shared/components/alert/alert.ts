import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IconComponent } from '@shared/components/icons/icon/icon';

export type AlertType = 'info' | 'success' | 'error' | 'warning';

@Component({
  selector: 'app-alert',
  imports: [IconComponent],
  templateUrl: './alert.html',
  styleUrl: './alert.css',
})
export class AlertComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly type = input<AlertType>('info');
  readonly message = input.required<string>();
  readonly actionLabel = input<string | null>(null);
  readonly action = input<(() => void) | null>(null);
  readonly dismissed = output<void>();

  protected isDismissing = signal(false);

  constructor() {
    effect(() => {
      this.message();
      const timer = setTimeout(() => {
        this.dismiss();
      }, 4000);
      this.destroyRef.onDestroy(() => clearTimeout(timer));
    });
  }

  protected get iconId(): string {
    return `icon-${this.type()}`;
  }

  protected readonly borderClass = computed(() => {
    switch (this.type()) {
      case 'success':
        return 'border-l-emerald-600';
      case 'error':
        return 'border-l-red-600';
      case 'warning':
        return 'border-l-amber-500';
      case 'info':
        return 'border-l-blue-600';
    }
  });

  protected readonly iconClass = computed(() => {
    switch (this.type()) {
      case 'success':
        return 'text-emerald-700';
      case 'error':
        return 'text-red-700';
      case 'warning':
        return 'text-amber-700';
      case 'info':
        return 'text-blue-700';
    }
  });

  protected readonly textClass = computed(() => {
    switch (this.type()) {
      case 'success':
        return 'text-emerald-900';
      case 'error':
        return 'text-red-900';
      case 'warning':
        return 'text-amber-900';
      case 'info':
        return 'text-blue-900';
    }
  });

  protected readonly bgClass = computed(() => {
    switch (this.type()) {
      case 'success':
        return 'bg-emerald-50';
      case 'error':
        return 'bg-red-50';
      case 'warning':
        return 'bg-amber-50';
      case 'info':
        return 'bg-blue-50';
    }
  });

  protected readonly closeClass = computed(() => {
    switch (this.type()) {
      case 'success':
        return 'text-emerald-700 hover:bg-emerald-100';
      case 'error':
        return 'text-red-700 hover:bg-red-100';
      case 'warning':
        return 'text-amber-700 hover:bg-amber-100';
      case 'info':
        return 'text-blue-700 hover:bg-blue-100';
    }
  });

  protected readonly toastClass = computed(() => {
    return `${this.bgClass()} ${this.borderClass()}`;
  });

  protected dismiss(): void {
    this.isDismissing.set(true);

    setTimeout(() => {
      this.dismissed.emit();
    }, 250);
  }

  protected onActionClick(): void {
    const action = this.action();
    if (action) {
      action();
    }
    this.dismiss();
  }
}
