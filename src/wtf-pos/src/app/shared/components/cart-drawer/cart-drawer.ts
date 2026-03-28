import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, OnDestroy, output, signal } from '@angular/core';
import { ModalStackService } from '@core/services';

const DRAWER_TRANSITION_PRIME_DELAY_MS = 16;

@Component({
  selector: 'app-cart-drawer',
  imports: [CommonModule],
  templateUrl: './cart-drawer.html',
})
export class CartDrawerComponent implements OnDestroy {
  private readonly modalStack = inject(ModalStackService);

  public readonly isOpen = input(false);
  public readonly ariaLabel = input('Cart drawer');

  public readonly closed = output<void>();
  protected readonly hasTransitions = signal(false);
  protected readonly dragOffsetY = signal(0);
  protected readonly isDragging = signal(false);
  private dragStartY = 0;
  private readonly dragDismissThreshold = 140;

  protected readonly drawerTransform = computed(() => {
    if (!this.isOpen()) {
      return 'translateY(100%)';
    }
    return `translateY(${this.dragOffsetY()}px)`;
  });

  protected readonly drawerTransitionDuration = computed(() => {
    if (!this.hasTransitions() || this.isDragging()) {
      return '0s';
    }
    return '0.3s';
  });

  private modalStackId: number | null = null;
  private initTimerId: number | null = null;

  constructor() {
    this.initTimerId = window.setTimeout(() => {
      this.hasTransitions.set(true);
      this.initTimerId = null;
    }, DRAWER_TRANSITION_PRIME_DELAY_MS);

    effect(() => {
      if (this.isOpen()) {
        this.modalStackId = this.modalStack.push(() => this.closeDrawer());
        this.dragOffsetY.set(0);
        this.isDragging.set(false);
      } else if (this.modalStackId !== null) {
        this.modalStack.remove(this.modalStackId);
        this.modalStackId = null;
      }
    });
  }

  public ngOnDestroy(): void {
    if (this.initTimerId !== null) {
      window.clearTimeout(this.initTimerId);
      this.initTimerId = null;
    }

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  protected closeDrawer(): void {
    this.closed.emit();
  }

  protected onDragStart(event: TouchEvent): void {
    if (!this.isOpen()) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('[data-cart-drag-handle]')) {
      return;
    }

    this.dragStartY = event.touches[0]?.clientY ?? 0;
    this.dragOffsetY.set(0);
    this.isDragging.set(true);
  }

  protected onDragMove(event: TouchEvent): void {
    if (!this.isDragging()) {
      return;
    }
    const currentY = event.touches[0]?.clientY ?? this.dragStartY;
    const delta = Math.max(0, currentY - this.dragStartY);
    this.dragOffsetY.set(delta);
  }

  protected onDragEnd(): void {
    if (!this.isDragging()) {
      return;
    }

    const shouldClose = this.dragOffsetY() > this.dragDismissThreshold;
    this.isDragging.set(false);
    this.dragOffsetY.set(0);

    if (shouldClose) {
      this.closeDrawer();
    }
  }
}
