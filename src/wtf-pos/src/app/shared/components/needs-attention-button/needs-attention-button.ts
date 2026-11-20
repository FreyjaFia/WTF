import { Component, computed, DestroyRef, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NeedsAttentionService } from '@core/services/needs-attention.service';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-needs-attention-button',
  imports: [IconComponent, RouterLink],
  templateUrl: './needs-attention-button.html',
  host: { class: 'relative inline-block' },
})
export class NeedsAttentionButtonComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly attention = inject(NeedsAttentionService);

  protected readonly total = this.attention.total;
  protected readonly route = AppRoutes.OrdersAttention;
  protected readonly badge = computed(() => (this.total() > 99 ? '99+' : String(this.total())));
  protected readonly label = computed(() => `Needs attention, ${this.total()} to look at`);

  public ngOnInit(): void {
    this.attention.start();
    this.destroyRef.onDestroy(() => this.attention.stop());
  }
}
