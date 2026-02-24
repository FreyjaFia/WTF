import { Injectable, effect, signal } from '@angular/core';
import { SuccessMessages } from '@core/messages';

export interface AlertState {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  visible: boolean;
}

@Injectable({ providedIn: 'root' })
export class AlertService {
  private readonly alertState = signal<AlertState>({
    type: 'error',
    message: '',
    visible: false,
  });

  public readonly alert = this.alertState.asReadonly();

  constructor() {
    effect(() => {
      const state = this.alertState();
      if (state.visible) {
        const timer = setTimeout(() => {
          this.dismiss();
        }, 5000);

        return () => clearTimeout(timer);
      }
      return undefined;
    });
  }

  public success(message: string): void {
    this.show('success', message);
  }

  public error(message: string): void {
    this.show('error', message);
  }

  public warning(message: string): void {
    this.show('warning', message);
  }

  public info(message: string): void {
    this.show('info', message);
  }

  public successCreated(entity: string): void {
    this.success(SuccessMessages.Common.Created(entity));
  }

  public successUpdated(entity: string): void {
    this.success(SuccessMessages.Common.Updated(entity));
  }

  public successDeleted(entity: string): void {
    this.success(SuccessMessages.Common.Deleted(entity));
  }

  public successSaved(entity: string): void {
    this.success(SuccessMessages.Common.Saved(entity));
  }

  public successUploaded(entity = 'Image'): void {
    this.success(SuccessMessages.Common.Uploaded(entity));
  }

  public errorUnauthorized(): void {
    this.error('You are not authorized to perform this action.');
  }

  public errorInvalidImageType(): void {
    this.error('Invalid image file type. Only JPG, PNG, GIF, and WebP are allowed.');
  }

  public errorFileTooLarge(maxSizeMb = 5): void {
    this.error(`File size exceeds ${maxSizeMb}MB limit.`);
  }

  public errorNothingToUpdate(): void {
    this.error('No changes to update.');
  }

  public getLoadErrorMessage(entity: string): string {
    return `Failed to load ${entity.toLowerCase()}.`;
  }

  public getCreateErrorMessage(entity: string): string {
    return `Failed to create ${entity.toLowerCase()}.`;
  }

  public getUpdateErrorMessage(entity: string): string {
    return `Failed to update ${entity.toLowerCase()}.`;
  }

  public getDeleteErrorMessage(entity: string): string {
    return `Failed to delete ${entity.toLowerCase()}.`;
  }

  public getUploadErrorMessage(entity = 'image'): string {
    return `Failed to upload ${entity.toLowerCase()}.`;
  }

  private show(type: AlertState['type'], message: string): void {
    this.alertState.set({ type, message, visible: true });
  }

  public dismiss(): void {
    this.alertState.update((state) => ({ ...state, visible: false }));
  }
}
