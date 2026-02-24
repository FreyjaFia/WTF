import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertService, ImageDownloadService } from '@core/services';
import { CartAddOnDto, CartItemDto, OrderStatusEnum, PaymentMethodEnum } from '@shared/models';

export interface ReceiptData {
  orderNumber?: number | null;
  orderLabel?: string | null;
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
export class OrderReceiptComponent implements OnInit {
  private readonly receiptEl = viewChild.required<ElementRef<HTMLElement>>('receiptEl');
  private readonly imageDownloadService = inject(ImageDownloadService);
  private readonly alertService = inject(AlertService);

  public readonly data = input<ReceiptData | null>(null);

  protected readonly isGenerating = signal(false);
  protected readonly logoDataUri = signal('');

  public ngOnInit(): void {
    this.loadLogo();
  }

  private loadLogo(): void {
    fetch('assets/images/logo_new.png')
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          this.logoDataUri.set(reader.result as string);
        };
        reader.readAsDataURL(blob);
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
      const orderLabel = this.data()?.orderLabel ?? this.data()?.orderNumber ?? 'new';
      const fileName = `WTF-Order-${orderLabel}.png`;
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
