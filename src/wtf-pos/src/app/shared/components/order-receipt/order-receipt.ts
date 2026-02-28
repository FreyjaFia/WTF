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
  private static readonly logoPath = '/assets/images/logo_new.png';
  private readonly receiptEl = viewChild.required<ElementRef<HTMLElement>>('receiptEl');
  private readonly imageDownloadService = inject(ImageDownloadService);
  private readonly alertService = inject(AlertService);
  private logoLoadPromise: Promise<void> | null = null;

  public readonly data = input<ReceiptData | null>(null);

  protected readonly isGenerating = signal(false);
  protected readonly logoDataUri = signal(OrderReceiptComponent.logoPath);

  public ngOnInit(): void {
    this.logoLoadPromise = this.loadLogo();
  }

  private async loadLogo(): Promise<void> {
    const sources = this.getLogoSources();
    for (const source of sources) {
      const fromFetch = await this.dataUrlFromFetch(source);
      if (fromFetch) {
        this.logoDataUri.set(fromFetch);
        return;
      }

      const fromImage = await this.dataUrlFromImage(source);
      if (fromImage) {
        this.logoDataUri.set(fromImage);
        return;
      }
    }

    // Keep static asset fallback when conversion fails.
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read logo as data URL.'));
      reader.readAsDataURL(blob);
    });
  }

  private getLogoSources(): string[] {
    const sources = new Set<string>();
    sources.add(OrderReceiptComponent.logoPath);
    sources.add('assets/images/logo_new.png');

    if (typeof window !== 'undefined') {
      sources.add(new URL(OrderReceiptComponent.logoPath, window.location.origin).toString());
      sources.add(new URL('assets/images/logo_new.png', window.location.href).toString());
    }

    if (typeof document !== 'undefined') {
      sources.add(new URL(OrderReceiptComponent.logoPath, document.baseURI).toString());
      sources.add(new URL('assets/images/logo_new.png', document.baseURI).toString());
    }

    return [...sources];
  }

  private async dataUrlFromFetch(source: string): Promise<string | null> {
    try {
      const res = await fetch(source, { cache: 'no-store' });
      if (!res.ok) {
        return null;
      }

      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) {
        return null;
      }

      return await this.blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  private dataUrlFromImage(source: string): Promise<string | null> {
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'sync';
      image.onload = () => {
        try {
          if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
            resolve(null);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          if (!context) {
            resolve(null);
            return;
          }

          context.drawImage(image, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = source;
    });
  }

  private waitForAnimationFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private async waitForFrames(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await this.waitForAnimationFrame();
    }
  }

  private async waitForLogoRender(): Promise<void> {
    await this.ensureEmbeddedLogoSource();

    const logo = this.receiptEl().nativeElement.querySelector(
      '[data-receipt-logo]',
    ) as HTMLImageElement | null;
    if (!logo) {
      return;
    }

    if (!logo.complete) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        logo.addEventListener('load', done, { once: true });
        logo.addEventListener('error', done, { once: true });
        setTimeout(done, 1200);
      });
    }

    if (typeof logo.decode === 'function') {
      try {
        await logo.decode();
      } catch {
        // Ignore decode errors and proceed with best-effort rendering.
      }
    }

    // Ensure src mutation to data URI has been committed before html-to-image clones the node.
    await this.waitForFrames(2);
  }

  private async ensureEmbeddedLogoSource(): Promise<void> {
    if (this.logoLoadPromise) {
      await this.logoLoadPromise;
    }

    if (this.logoDataUri().startsWith('data:')) {
      return;
    }

    const logo = this.receiptEl().nativeElement.querySelector(
      '[data-receipt-logo]',
    ) as HTMLImageElement | null;

    if (!logo) {
      return;
    }

    if (!logo.complete) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        logo.addEventListener('load', done, { once: true });
        logo.addEventListener('error', done, { once: true });
        setTimeout(done, 1200);
      });
    }

    if (logo.naturalWidth <= 0 || logo.naturalHeight <= 0) {
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = logo.naturalWidth;
      canvas.height = logo.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      context.drawImage(logo, 0, 0);
      this.logoDataUri.set(canvas.toDataURL('image/png'));

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    } catch {
      // Keep static source fallback when canvas conversion fails.
    }
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

  protected getUnitSubtotal(item: CartItemDto): number {
    const addOnTotal = (item.addOns ?? []).reduce(
      (sum: number, ao: CartAddOnDto) => sum + ao.price,
      0,
    );
    return item.price + addOnTotal;
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
