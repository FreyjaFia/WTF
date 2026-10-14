import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { PromotionService } from './promotion.service';

afterEach(() => vi.restoreAllMocks());

describe('PromotionService', () => {
  const root = `${environment.apiUrl}/management/promotions`;
  const kinds = [
    { name: 'fixed bundle', path: `${root}/fixed-bundles`, list: 'getFixedBundles', get: 'getFixedBundle', create: 'createFixedBundle', update: 'updateFixedBundle', remove: 'deleteFixedBundle' },
    { name: 'mix & match', path: `${root}/mix-match`, list: 'getMixMatchPromotions', get: 'getMixMatchPromotion', create: 'createMixMatch', update: 'updateMixMatch', remove: 'deleteMixMatch' },
    { name: 'discounted product', path: `${root}/discounted-products`, list: 'getDiscountedProductPromotions', get: 'getDiscountedProductPromotion', create: 'createDiscountedProduct', update: 'updateDiscountedProduct', remove: 'deleteDiscountedProduct' },
  ] as const;

  describe.each(kinds)('$name endpoints', (kind) => {
    it('lists, reads, creates, updates and deletes at its own path', () => {
      const { service, http } = setupHttpService(PromotionService);
      const s = service as unknown as Record<string, (...args: unknown[]) => { subscribe: () => void }>;

      s[kind.list]().subscribe();
      expect(http.expectOne(kind.path).request.method).toBe('GET');

      s[kind.get]('1').subscribe();
      expect(http.expectOne(`${kind.path}/1`).request.method).toBe('GET');

      s[kind.create]({ name: 'x' }).subscribe();
      const create = http.expectOne(kind.path);
      expect(create.request.method).toBe('POST');
      expect(create.request.body).toEqual({ name: 'x' });

      s[kind.update]({ id: '2', name: 'y' }).subscribe();
      const update = http.expectOne(`${kind.path}/2`);
      expect(update.request.method).toBe('PUT');
      expect(update.request.body).toEqual({ promotionId: '2', id: '2', name: 'y' });

      s[kind.remove]('3').subscribe();
      expect(http.expectOne(`${kind.path}/3`).request.method).toBe('DELETE');
    });
  });

  it('handles images, restore and POS list', () => {
    const { service, http } = setupHttpService(PromotionService);

    service.getActiveDiscountedProductPromotions().subscribe();
    expect(http.expectOne(`${environment.apiUrl}/pos/promotions/discounted-products`).request.method).toBe('GET');

    service.uploadPromotionImage('p1', new File(['x'], 'a.png')).subscribe();
    const upload = http.expectOne(`${root}/p1/images`);
    expect(upload.request.method).toBe('POST');
    expect((upload.request.body as FormData).get('file')).toBeInstanceOf(File);

    service.deletePromotionImage('p1').subscribe();
    expect(http.expectOne(`${root}/p1/images`).request.method).toBe('DELETE');

    service.restorePromotion('p2').subscribe();
    expect(http.expectOne(`${root}/p2/restore`).request.method).toBe('POST');
  });

  describe('error mapping', () => {
    it('network loss re-checks connectivity', () => {
      const { service, http, connectivity } = setupHttpService(PromotionService);
      const result = capture(service.getFixedBundles());

      failNetwork(http.expectOne(`${root}/fixed-bundles`));

      expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(connectivity.checkNow).toHaveBeenCalled();
    });

    it('surfaces the server message, else a generic one', () => {
      const { service, http } = setupHttpService(PromotionService);
      const server = capture(service.createMixMatch({} as never));
      failWith(http.expectOne(`${root}/mix-match`), 400, { message: 'Duplicate products are not allowed.' });
      const generic = capture(service.createMixMatch({} as never));
      failWith(http.expectOne(`${root}/mix-match`), 500);

      expect(server.error).toBe('Duplicate products are not allowed.');
      expect(generic.error).toBe(ServiceErrorMessages.Promotion.RequestFailed);
    });
  });
});
