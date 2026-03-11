import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthLoadingService {
  public readonly checkingSession = signal(false);
  public readonly loadingProfile = signal(false);

  public setCheckingSession(value: boolean): void {
    this.checkingSession.set(value);
  }

  public setLoadingProfile(value: boolean): void {
    this.loadingProfile.set(value);
  }
}
