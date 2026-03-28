import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DockComponent } from '@shared/components/dock/dock';
import { HeaderComponent } from '@shared/components/header/header';
import { OfflineBannerComponent } from '@shared/components/offline-banner/offline-banner';
import { SidebarComponent } from '@shared/components/sidebar/sidebar';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, DockComponent, HeaderComponent, OfflineBannerComponent, SidebarComponent],
  templateUrl: './layout.html',
})
export class LayoutComponent implements AfterViewInit, OnDestroy {
  @ViewChild('sidebarHost') private readonly sidebarHost?: ElementRef<HTMLElement>;

  private readonly host = inject(ElementRef<HTMLElement>);
  private resizeObserver?: ResizeObserver;
  private mediaQuery?: MediaQueryList;
  private readonly onMediaChange = () => this.updateSidebarWidth();

  public ngAfterViewInit(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.mediaQuery = window.matchMedia('(min-width: 768px)');
    this.mediaQuery.addEventListener?.('change', this.onMediaChange);

    if (this.sidebarHost?.nativeElement) {
      this.resizeObserver = new ResizeObserver(() => this.updateSidebarWidth());
      this.resizeObserver.observe(this.sidebarHost.nativeElement);
    }

    this.updateSidebarWidth();
  }

  public ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.mediaQuery?.removeEventListener?.('change', this.onMediaChange);
  }

  private updateSidebarWidth(): void {
    const target = this.host.nativeElement;
    const root = target.ownerDocument?.documentElement;

    if (!this.mediaQuery?.matches) {
      target.style.setProperty('--sidebar-width', '0px');
      root?.style.setProperty('--sidebar-width', '0px');
      return;
    }

    const sidebarEl = this.sidebarHost?.nativeElement;
    const width = sidebarEl ? Math.round(sidebarEl.getBoundingClientRect().width) : 0;
    target.style.setProperty('--sidebar-width', `${width}px`);
    root?.style.setProperty('--sidebar-width', `${width}px`);
  }
}
