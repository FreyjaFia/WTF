import { ApiClient } from '@api/client';
import { isoInDays } from '@utils/dates';
import { unique } from '@utils/unique';

export interface Promotion {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

export type PromotionKind = 'fixed-bundles' | 'mix-match' | 'discounted-products';

export class PromotionsApi {
  public constructor(private readonly api: ApiClient) {}

  private base(name: string): Record<string, unknown> {
    return { name, isActive: true, startDate: isoInDays(-1), endDate: isoInDays(30), daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: null, maxPerOrder: null };
  }

  public async fixedBundle(productIds: readonly string[], bundlePrice: number, name: string = unique('E2E Bundle')): Promise<Promotion> {
    return this.api.json<Promotion>('superadmin', 'POST', 'management/promotions/fixed-bundles', {
      ...this.base(name),
      bundlePrice,
      items: productIds.map((productId) => ({ productId, quantity: 1, addOns: [] })),
    });
  }

  public async mixMatch(productIds: readonly string[], requiredQuantity: number, bundlePrice: number, name: string = unique('E2E Mix')): Promise<Promotion> {
    return this.api.json<Promotion>('superadmin', 'POST', 'management/promotions/mix-match', {
      ...this.base(name),
      requiredQuantity,
      maxSelectionsPerOrder: null,
      bundlePrice,
      items: productIds.map((productId) => ({ productId, addOns: [] })),
    });
  }

  public async discounted(productId: string, fixedPrice: number, name: string = unique('E2E Deal')): Promise<Promotion> {
    return this.api.json<Promotion>('superadmin', 'POST', 'management/promotions/discounted-products', {
      ...this.base(name),
      items: [{ productId, fixedPrice, percentOff: null, addOns: [] }],
    });
  }

  public async remove(kind: PromotionKind, id: string): Promise<void> {
    await this.api.json<unknown>('superadmin', 'DELETE', `management/promotions/${kind}/${id}`);
  }

  public async restore(id: string): Promise<void> {
    await this.api.json<unknown>('superadmin', 'POST', `management/promotions/${id}/restore`);
  }
}
