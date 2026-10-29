import { APIResponse } from '@playwright/test';
import { ApiClient } from '@api/client';
import { Promotion } from '@api/promotions';
import { Order } from '@api/orders';
import { OrderStatus, PaymentMethod } from '@data/enums';
import { TIME_ZONE } from '@data/env';
import { isoInDays } from '@utils/dates';
import { unique } from '@utils/unique';

export interface ScheduleInput {
  readonly daysOfWeek?: number | null;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
  readonly maxRedemptions?: number | null;
  readonly maxPerOrder?: number | null;
}

export interface WindowInput {
  readonly name?: string;
  readonly isActive?: boolean;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly schedule?: ScheduleInput;
}

export interface DiscountInput extends WindowInput {
  readonly productId: string;
  readonly amountOff?: number | null;
  readonly percentOff?: number | null;
}

export interface BundleLine {
  readonly productId: string;
  readonly quantity: number;
  readonly bundleId?: string;
}

export interface BundleSale {
  readonly promotionId: string;
  readonly quantity: number;
}

export interface SavedLine {
  readonly id: string;
  readonly productId: string;
  readonly quantity: number;
  readonly price: number | null;
  readonly originalPrice: number | null;
  readonly promoLabel: string | null;
  readonly discountPromotionId: string | null;
}

export interface PricedOrder extends Omit<Order, 'items'> {
  readonly items: readonly SavedLine[];
  readonly bundlePromotions?: readonly { readonly promotionId: string; readonly quantity: number; readonly unitPrice: number }[];
}

export interface PromotionDetails {
  readonly id: string;
  readonly isActive: boolean;
  readonly schedule: { readonly redemptions: number; readonly maxRedemptions: number | null } | null;
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

export function manilaWeekday(offsetDays: number = 0): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' }).format(new Date(Date.now() + offsetDays * DAY_MS));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

export function weekdayBit(offsetDays: number = 0): number {
  return 1 << manilaWeekday(offsetDays);
}

export function manilaClock(offsetMinutes: number = 0): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(Date.now() + offsetMinutes * 60_000),
  );
  return parts;
}

export class PromotionsExtra {
  public constructor(private readonly api: ApiClient) {}

  private window(input: WindowInput, defaultName: string): Record<string, unknown> {
    return {
      name: input.name ?? defaultName,
      isActive: input.isActive ?? true,
      startDate: input.startDate === undefined ? isoInDays(-1) : input.startDate,
      endDate: input.endDate === undefined ? isoInDays(30) : input.endDate,
      schedule: input.schedule
        ? {
            daysOfWeek: input.schedule.daysOfWeek ?? null,
            startTime: input.schedule.startTime ?? null,
            endTime: input.schedule.endTime ?? null,
            maxRedemptions: input.schedule.maxRedemptions ?? null,
            maxPerOrder: input.schedule.maxPerOrder ?? null,
          }
        : undefined,
    };
  }

  public async discountedRaw(input: DiscountInput): Promise<APIResponse> {
    return this.api.call('superadmin', 'POST', 'management/promotions/discounted-products', {
      body: {
        ...this.window(input, unique('E2E Deal')),
        items: [{ productId: input.productId, fixedPrice: input.amountOff ?? null, percentOff: input.percentOff ?? null, addOns: [] }],
      },
    });
  }

  public async discounted(input: DiscountInput): Promise<Promotion> {
    return ApiClient.parse<Promotion>(await this.discountedRaw(input), 'create discounted promotion');
  }

  public async fixedBundleRaw(
    productIds: readonly string[],
    bundlePrice: number,
    input: WindowInput = {},
  ): Promise<APIResponse> {
    return this.api.call('superadmin', 'POST', 'management/promotions/fixed-bundles', {
      body: {
        ...this.window(input, unique('E2E Bundle')),
        bundlePrice,
        items: productIds.map((productId) => ({ productId, quantity: 1, addOns: [] })),
      },
    });
  }

  public async fixedBundle(productIds: readonly string[], bundlePrice: number, input: WindowInput = {}): Promise<Promotion> {
    return ApiClient.parse<Promotion>(await this.fixedBundleRaw(productIds, bundlePrice, input), 'create fixed bundle');
  }

  public async mixMatchRaw(
    productIds: readonly string[],
    requiredQuantity: number,
    bundlePrice: number,
    input: WindowInput & { readonly maxSelectionsPerOrder?: number | null } = {},
  ): Promise<APIResponse> {
    return this.api.call('superadmin', 'POST', 'management/promotions/mix-match', {
      body: {
        ...this.window(input, unique('E2E Mix')),
        requiredQuantity,
        maxSelectionsPerOrder: input.maxSelectionsPerOrder ?? null,
        bundlePrice,
        items: productIds.map((productId) => ({ productId, addOns: [] })),
      },
    });
  }

  public async mixMatch(
    productIds: readonly string[],
    requiredQuantity: number,
    bundlePrice: number,
    input: WindowInput & { readonly maxSelectionsPerOrder?: number | null } = {},
  ): Promise<Promotion> {
    return ApiClient.parse<Promotion>(await this.mixMatchRaw(productIds, requiredQuantity, bundlePrice, input), 'create mix and match');
  }

  public async discountedDetails(id: string): Promise<PromotionDetails> {
    return this.api.json<PromotionDetails>('superadmin', 'GET', `management/promotions/discounted-products/${id}`);
  }

  public bundleOrderBody(lines: readonly BundleLine[], bundles: readonly BundleSale[]): Record<string, unknown> {
    return {
      customerId: null,
      items: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        addOns: [],
        specialInstructions: null,
        bundlePromotionId: line.bundleId ?? null,
      })),
      bundlePromotions: bundles.map((bundle) => ({ promotionId: bundle.promotionId, quantity: bundle.quantity })),
      status: OrderStatus.Completed,
      paymentMethod: PaymentMethod.Cash,
      amountReceived: 100000,
      tips: null,
    };
  }

  public async sellRaw(lines: readonly BundleLine[], bundles: readonly BundleSale[] = []): Promise<APIResponse> {
    return this.api.call('cashier', 'POST', 'orders', { body: this.bundleOrderBody(lines, bundles) });
  }

  public async sell(lines: readonly BundleLine[], bundles: readonly BundleSale[] = []): Promise<PricedOrder> {
    return ApiClient.parse<PricedOrder>(await this.sellRaw(lines, bundles), 'create order');
  }

  public async sellPlain(productId: string, quantity: number): Promise<PricedOrder> {
    return this.sell([{ productId, quantity }]);
  }
}
