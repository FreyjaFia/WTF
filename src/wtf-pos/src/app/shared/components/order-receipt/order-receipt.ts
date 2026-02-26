import { CommonModule } from '@angular/common';
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
import { Capacitor } from '@capacitor/core';
import { SuccessMessages } from '@core/messages';
import { AlertService, ImageDownloadService } from '@core/services';
import { CartAddOnDto, CartItemDto, OrderStatusEnum, PaymentMethodEnum } from '@shared/models';
import { SortAddOnsPipe } from '@shared/pipes';

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
  imports: [CommonModule, SortAddOnsPipe],
  templateUrl: './order-receipt.html',
})
export class OrderReceiptComponent implements OnInit {
  private readonly receiptEl = viewChild.required<ElementRef<HTMLElement>>('receiptEl');
  private readonly imageDownloadService = inject(ImageDownloadService);
  private readonly alertService = inject(AlertService);
  private logoLoadPromise: Promise<void> | null = null;

  public readonly data = input<ReceiptData | null>(null);

  protected readonly isGenerating = signal(false);
  protected readonly logoDataUri = signal('assets/images/logo_new.png');

  public ngOnInit(): void {
    this.logoLoadPromise = this.loadLogo();
  }

  private async loadLogo(): Promise<void> {
    try {
      const res = await fetch('assets/images/logo_new.png');
      const blob = await res.blob();
      const dataUrl = await this.blobToDataUrl(blob);
      this.logoDataUri.set(dataUrl);
    } catch {
      // Keep static asset fallback when conversion fails.
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read logo as data URL.'));
      reader.readAsDataURL(blob);
    });
  }

  private async waitForLogoRender(): Promise<void> {
    if (this.logoLoadPromise) {
      await this.logoLoadPromise;
    }

    const logo = this.receiptEl().nativeElement.querySelector(
      '[data-receipt-logo]',
    ) as HTMLImageElement | null;
    if (!logo || logo.complete) {
      return;
    }

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      logo.addEventListener('load', done, { once: true });
      logo.addEventListener('error', done, { once: true });
      setTimeout(done, 1200);
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
      await this.waitForLogoRender();
      const orderLabel = this.data()?.orderLabel ?? this.data()?.orderNumber ?? 'new';
      const fileName = `WTF-Order-${orderLabel}.png`;
      await this.imageDownloadService.downloadElementAsImage(
        this.receiptEl().nativeElement,
        fileName,
      );
      if (Capacitor.getPlatform() !== 'android') {
        this.alertService.success(SuccessMessages.OrderReceipt.ImageDownloaded);
      }
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
