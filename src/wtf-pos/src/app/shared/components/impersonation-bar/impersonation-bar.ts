import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PlatformService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { ImpersonationInfo } from '@shared/models/platform.models';

@Component({
  selector: 'app-impersonation-bar',
  templateUrl: './impersonation-bar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImpersonationBarComponent implements OnInit, OnDestroy {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);

  protected readonly info = signal<ImpersonationInfo | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;

  public ngOnInit(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 15000);
  }

  public ngOnDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  protected leave(): void {
    this.platform.endImpersonation();
    this.info.set(null);
    this.router.navigateByUrl(AppRoutes.PlatformRoot, { replaceUrl: true });
  }

  private refresh(): void {
    const current = this.platform.getImpersonation();

    if (this.info() && !current) {
      this.router.navigateByUrl(AppRoutes.Login, { replaceUrl: true });
    }

    this.info.set(current);
  }
}
