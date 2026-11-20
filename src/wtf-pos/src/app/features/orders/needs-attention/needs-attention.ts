import { Component, computed, DestroyRef, inject, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, NeedsAttentionService } from '@core/services';
import { IconComponent } from '@shared/components';
import { AppRoutes } from '@shared/constants/app-routes';

interface AttentionTab {
  id: string;
  label: string;
  shortLabel: string;
  route: string;
  count: number;
}

@Component({
  selector: 'app-needs-attention',
  imports: [IconComponent, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './needs-attention.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class NeedsAttention implements OnInit {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly attention = inject(NeedsAttentionService);

  protected readonly tabs = computed<AttentionTab[]>(() => {
    const tabs: AttentionTab[] = [];

    if (this.auth.canWriteOrders()) {
      tabs.push({ id: 'awaiting', label: 'Awaiting approval', shortLabel: 'Awaiting', route: AppRoutes.OrdersAwaiting, count: this.attention.awaiting() });
    }

    if (this.auth.canOverrideOrders()) {
      tabs.push({ id: 'unsynced', label: 'Unsynced', shortLabel: 'Unsynced', route: AppRoutes.OrdersUnsynced, count: this.attention.unsynced() });
      tabs.push({ id: 'review', label: 'Offline review', shortLabel: 'Review', route: AppRoutes.OrdersHeld, count: this.attention.held() });
    }

    return tabs;
  });

  public ngOnInit(): void {
    this.attention.start();
    this.destroyRef.onDestroy(() => this.attention.stop());
  }

  protected backToOrders(): void {
    void this.router.navigateByUrl(AppRoutes.OrdersList);
  }
}
