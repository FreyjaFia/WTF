import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { environment } from '@environments/environment.development';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { ProductService } from './product.service';

afterEach(() => vi.restoreAllMocks());

describe('ProductService', () => {
  const base = `${environment.apiUrl}/products`;
  const msgs = ServiceErrorMessages.Product;

  it('builds product list filters, keeping falsy-but-defined values', () => {
    const { service, http } = setupHttpService(ProductService);
    service.getProducts({ searchTerm: 'latte', category: 0 as never, isAddOn: false, isActive: true }).subscribe();

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('searchTerm')).toBe('latte');
    expect(req.request.params.get('category')).toBe('0');
    expect(req.request.params.get('isAddOn')).toBe('false');
    expect(req.request.params.get('isActive')).toBe('true');
    req.flush([]);
  });

  it('omits unset filters', () => {
    const { service, http } = setupHttpService(ProductService);
    service.getProducts({ searchTerm: '', category: null, isAddOn: null, isActive: null }).subscribe();

    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
  });

  it('calls the right endpoint and verb for each operation', () => {
    const { service, http } = setupHttpService(ProductService);

    service.getProduct('1').subscribe();
    expect(http.expectOne(`${base}/1`).request.method).toBe('GET');

    service.createProduct({ name: 'x' } as never).subscribe();
    expect(http.expectOne(base).request.method).toBe('POST');

    service.updateProduct({ id: '2' } as never).subscribe();
    expect(http.expectOne(`${base}/2`).request.method).toBe('PUT');

    service.deleteProduct('3').subscribe();
    expect(http.expectOne(`${base}/3`).request.method).toBe('DELETE');

    service.restoreProduct('4').subscribe();
    expect(http.expectOne(`${base}/4/restore`).request.method).toBe('POST');

    service.uploadProductImage('5', new File(['x'], 'a.png')).subscribe();
    const upload = http.expectOne(`${base}/5/images`);
    expect((upload.request.body as FormData).get('file')).toBeInstanceOf(File);

    service.deleteProductImage('6').subscribe();
    expect(http.expectOne(`${base}/6/images`).request.method).toBe('DELETE');

    service.getProductAddOns('7').subscribe();
    expect(http.expectOne(`${base}/7/addons`).request.method).toBe('GET');

    service.getLinkedProducts('8').subscribe();
    expect(http.expectOne(`${base}/addons/8/products`).request.method).toBe('GET');
  });

  it('assignment endpoints wrap the payload with the owner id', () => {
    const { service, http } = setupHttpService(ProductService);

    service.assignProductAddOns('p1', [{ addOnId: 'a' }] as never).subscribe();
    const addOns = http.expectOne(`${base}/p1/addons`);
    expect(addOns.request.body).toEqual({ productId: 'p1', addOns: [{ addOnId: 'a' }] });

    service.assignLinkedProducts('a1', [{ productId: 'p' }] as never).subscribe();
    const products = http.expectOne(`${base}/addons/a1/products`);
    expect(products.request.body).toEqual({ addOnId: 'a1', products: [{ productId: 'p' }] });
  });

  it('price override endpoints use product and add-on ids in the path', () => {
    const { service, http } = setupHttpService(ProductService);

    service.getProductAddOnPriceOverrides('p1').subscribe();
    expect(http.expectOne(`${base}/p1/addon-price-overrides`).request.method).toBe('GET');

    service.createProductAddOnPriceOverride({ productId: 'p1', addOnId: 'a1', price: 5 } as never).subscribe();
    const create = http.expectOne(`${base}/p1/addon-price-overrides`);
    expect(create.request.method).toBe('POST');

    service.updateProductAddOnPriceOverride({ productId: 'p1', addOnId: 'a1', price: 6 } as never).subscribe();
    const update = http.expectOne(`${base}/p1/addon-price-overrides/a1`);
    expect(update.request.method).toBe('PUT');

    service.deleteProductAddOnPriceOverride('p1', 'a1').subscribe();
    expect(http.expectOne(`${base}/p1/addon-price-overrides/a1`).request.method).toBe('DELETE');
  });

  describe('error mapping', () => {
    it('network loss re-checks connectivity', () => {
      const { service, http, connectivity } = setupHttpService(ProductService);
      const result = capture(service.getProduct('1'));

      failNetwork(http.expectOne(`${base}/1`));

      expect(result.error).toBe(HttpErrorMessages.NetworkUnavailable);
      expect(connectivity.checkNow).toHaveBeenCalled();
    });

    it('server messages are surfaced', () => {
      const { service, http } = setupHttpService(ProductService);
      const result = capture(service.createProduct({} as never));

      failWith(http.expectOne(base), 400, { message: 'Product code already exists.' });

      expect(result.error).toBe('Product code already exists.');
    });

    it('assignProductAddOns maps 400, 404 and fallback', () => {
      const { service, http } = setupHttpService(ProductService);
      const bad = capture(service.assignProductAddOns('p', []));
      failWith(http.expectOne(`${base}/p/addons`), 400);
      const missing = capture(service.assignProductAddOns('p', []));
      failWith(http.expectOne(`${base}/p/addons`), 404);
      const fallback = capture(service.assignProductAddOns('p', []));
      failWith(http.expectOne(`${base}/p/addons`), 500);

      expect(bad.error).toBe(msgs.InvalidAddOnsRequest);
      expect(missing.error).toBe(msgs.ProductNotFound);
      expect(fallback.error).toBe(msgs.AssignAddOnsFailed);
    });

    it('assignLinkedProducts maps 400, 404 and fallback', () => {
      const { service, http } = setupHttpService(ProductService);
      const bad = capture(service.assignLinkedProducts('a', []));
      failWith(http.expectOne(`${base}/addons/a/products`), 400);
      const missing = capture(service.assignLinkedProducts('a', []));
      failWith(http.expectOne(`${base}/addons/a/products`), 404);
      const fallback = capture(service.assignLinkedProducts('a', []));
      failWith(http.expectOne(`${base}/addons/a/products`), 500);

      expect(bad.error).toBe(msgs.InvalidProductsRequest);
      expect(missing.error).toBe(msgs.AddOnNotFound);
      expect(fallback.error).toBe(msgs.AssignProductsFailed);
    });

    it('price override mutations map statuses', () => {
      const { service, http } = setupHttpService(ProductService);
      const payload = { productId: 'p', addOnId: 'a' } as never;
      const createBad = capture(service.createProductAddOnPriceOverride(payload));
      failWith(http.expectOne(`${base}/p/addon-price-overrides`), 400);
      const createMissing = capture(service.createProductAddOnPriceOverride(payload));
      failWith(http.expectOne(`${base}/p/addon-price-overrides`), 404);
      const updateBad = capture(service.updateProductAddOnPriceOverride(payload));
      failWith(http.expectOne(`${base}/p/addon-price-overrides/a`), 400);
      const updateMissing = capture(service.updateProductAddOnPriceOverride(payload));
      failWith(http.expectOne(`${base}/p/addon-price-overrides/a`), 404);
      const deleteMissing = capture(service.deleteProductAddOnPriceOverride('p', 'a'));
      failWith(http.expectOne(`${base}/p/addon-price-overrides/a`), 404);
      const deleteFallback = capture(service.deleteProductAddOnPriceOverride('p', 'a'));
      failWith(http.expectOne(`${base}/p/addon-price-overrides/a`), 500);

      expect(createBad.error).toBe(msgs.InvalidPriceOverrideRequest);
      expect(createMissing.error).toBe(msgs.ProductOrAddOnNotFound);
      expect(updateBad.error).toBe(msgs.InvalidPriceOverrideRequest);
      expect(updateMissing.error).toBe(msgs.PriceOverrideNotFound);
      expect(deleteMissing.error).toBe(msgs.PriceOverrideNotFound);
      expect(deleteFallback.error).toBe(msgs.DeletePriceOverrideFailed);
    });
  });
});
