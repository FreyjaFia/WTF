import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertService, ImageDownloadService } from '@core/services';
import { CartAddOnDto, CartItemDto, OrderStatusEnum, PaymentMethodEnum } from '@shared/models';

export interface ReceiptData {
  orderNumber?: number | null;
  customerName: string;
  date: string;
  status: OrderStatusEnum;
  items: CartItemDto[];
  specialInstructions?: string | null;
  totalAmount: number;
  paymentMethod?: PaymentMethodEnum | null;
  amountReceived?: number | null;
  changeAmount?: number | null;
  tips?: number | null;
}

@Component({
  selector: 'app-order-receipt',
  imports: [CommonModule],
  templateUrl: './order-receipt.html',
})
export class OrderReceiptComponent implements OnInit, OnDestroy {
  private readonly receiptEl = viewChild.required<ElementRef<HTMLElement>>('receiptEl');
  private readonly imageDownloadService = inject(ImageDownloadService);
  private readonly alertService = inject(AlertService);

  public readonly data = input<ReceiptData | null>(null);

  protected readonly isGenerating = signal(false);
  protected readonly logoDataUri = signal('');

  private logoBlobUrl: string | null = null;

  public ngOnInit(): void {
    this.loadLogo();
  }

  public ngOnDestroy(): void {
    if (this.logoBlobUrl) {
      URL.revokeObjectURL(this.logoBlobUrl);
    }
  }

  private loadLogo(): void {
    fetch('assets/images/logo_new.png')
      .then((res) => res.blob())
      .then((blob) => {
        this.logoBlobUrl = URL.createObjectURL(blob);
        this.logoDataUri.set(this.logoBlobUrl);
      });
  }

  protected readonly hasPaymentInfo = computed(() => {
    const d = this.data();
    return d?.paymentMethod != null;
  });

  protected readonly paymentMethodLabel = computed(() => {
    switch (this.data()?.paymentMethod) {
      case PaymentMethodEnum.Cash:
        return 'Cash';
      case PaymentMethodEnum.GCash:
        return 'GCash';
      default:
        return 'N/A';
    }
  });

  protected getItemTotal(item: CartItemDto): number {
    const addOnTotal = (item.addOns ?? []).reduce(
      (sum: number, ao: CartAddOnDto) => sum + ao.price,
      0,
    );
    return item.qty * (item.price + addOnTotal);
  }

  public async generate(): Promise<void> {
    this.isGenerating.set(true);
    try {
      const orderNumber = this.data()?.orderNumber ?? 'new';
      const fileName = `WTF-Order-${orderNumber}.png`;
      await this.imageDownloadService.downloadElementAsImage(
        this.receiptEl().nativeElement,
        fileName,
      );
    } catch {
      this.alertService.error('Failed to generate order image.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  public getIsGenerating(): boolean {
    return this.isGenerating();
  }
}
