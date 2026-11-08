import { environment } from '@environments/environment.development';
import { SupplierDto } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { capture, failNetwork, failWith, setupHttpService } from '../../testing/service-testing';
import { SupplierService } from './supplier.service';

describe('SupplierService', () => {
  const url = `${environment.apiUrl}/suppliers`;
  const itemUrl = `${environment.apiUrl}/items/i1/suppliers`;
  const supplier = { summary: { id: 's1' }, items: [] } as unknown as SupplierDto;
  const fields = {
    name: 'Metro',
    contactName: null,
    phone: null,
    email: null,
    address: null,
    leadTimeDays: 2,
    paymentTerms: null,
    notes: null,
  };

  it('lists suppliers, optionally with inactive ones and a search', () => {
    const { service, http } = setupHttpService(SupplierService);
    capture(service.getSuppliers());
    http.expectOne(url).flush([]);

    capture(service.getSuppliers({ includeInactive: true, search: 'met' }));
    http.expectOne(`${url}?includeInactive=true&search=met`).flush([]);
  });

  it('creates and updates a supplier', () => {
    const { service, http } = setupHttpService(SupplierService);
    const created = capture(service.createSupplier(fields));
    const create = http.expectOne(url);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(fields);
    create.flush(supplier);
    expect(created.value).toEqual(supplier);

    capture(service.updateSupplier('s1', fields));
    const update = http.expectOne(`${url}/s1`);
    expect(update.request.method).toBe('PUT');
    update.flush(supplier);
  });

  it('deactivates and restores a supplier', () => {
    const { service, http } = setupHttpService(SupplierService);
    capture(service.deactivateSupplier('s1'));
    http.expectOne(`${url}/s1/deactivate`).flush(supplier);

    capture(service.restoreSupplier('s1'));
    http.expectOne(`${url}/s1/restore`).flush(supplier);
  });

  it('saves and removes an item supplier link', () => {
    const { service, http } = setupHttpService(SupplierService);
    const body = { supplierItemCode: null, packName: 'carton', unitsPerPack: 12, packPrice: 840, isPreferred: true };
    capture(service.saveItemSupplier('i1', 's1', body));
    const save = http.expectOne(`${itemUrl}/s1`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual(body);
    save.flush([]);

    capture(service.removeItemSupplier('i1', 's1'));
    expect(http.expectOne(`${itemUrl}/s1`).request.method).toBe('DELETE');
  });

  it('reports the server message, and a network message when offline', () => {
    const { service, http } = setupHttpService(SupplierService);
    const bad = capture(service.createSupplier(fields));
    failWith(http.expectOne(url), 400, 'A supplier named "Metro" already exists.');
    expect(bad.error).toContain('already exists');

    const offline = capture(service.getSuppliers());
    failNetwork(http.expectOne(url));
    expect(offline.error).toBeTruthy();
  });
});
