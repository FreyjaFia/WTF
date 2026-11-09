import { PurchasingApi, asRole } from '@api/purchasing';
import { GROUPS } from '@data/role-groups';
import { Role } from '@data/users';
import { expect, test } from '@fixtures/index';
import { SupplierDetailsPage, SuppliersPage } from '@pages/purchasing.page';
import { unique } from '@utils/unique';

test.describe('suppliers @inventory @suppliers', () => {
  test('a supplier added on the page is listed, searchable and opens its details', async ({ signIn }) => {
    const name = unique('Metro Dairy');
    const page = await signIn('admin');
    const suppliers = new SuppliersPage(page);
    await suppliers.open();

    await suppliers.addButton.click();
    await suppliers.nameInput.fill(name);
    await page.getByRole('button', { name: 'Add Supplier', exact: true }).last().click();

    await expect(page.locator('[data-testid="supplier-title"]')).toHaveText(name);
    await suppliers.open();
    await expect(suppliers.row(name)).toBeVisible();

    await suppliers.search.fill(name);
    await expect(suppliers.row(name)).toHaveCount(1);
    await suppliers.search.fill('no such supplier xyz');
    await expect(suppliers.empty).toBeVisible();
  });

  test('a supplier needs a name and the name is unique within the shop', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const name = unique('Unique Supplier');
    await buy.createSupplier(name);

    const duplicate = await api.client.call('owner', 'POST', 'suppliers', { body: { name } });
    expect(duplicate.status()).toBe(400);
    const blank = await api.client.call('owner', 'POST', 'suppliers', { body: { name: '   ' } });
    expect(blank.status()).toBe(400);

    const page = await signIn('admin');
    const suppliers = new SuppliersPage(page);
    await suppliers.open();
    await suppliers.addButton.click();
    await page.getByRole('button', { name: 'Add Supplier', exact: true }).last().click();
    await expect(page.getByText("Enter the supplier's name.")).toBeVisible();
  });

  test('an item is linked with its pack, and the cost of one unit is worked out', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();

    const page = await signIn('admin');
    const details = new SupplierDetailsPage(page);
    await details.open(supplier.summary.id);
    await details.linkItem(item.name, { name: 'carton', units: 12, price: 840 });

    const row = details.itemRow(item.name);
    await expect(row).toBeVisible();
    await expect(row).toContainText('carton');
    await expect(row).toContainText('70.00');
    const stored = await buy.supplier(supplier.summary.id);
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]).toMatchObject({ unitsPerPack: 12, packPrice: 840, unitCost: 70 });
  });

  test('only one supplier is preferred for an item at a time', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const item = await buy.createItem();
    const first = await buy.createSupplier();
    const second = await buy.createSupplier();
    await buy.link(item.id, first.summary.id, { isPreferred: true });
    await buy.link(item.id, second.summary.id, { isPreferred: true });

    expect((await buy.supplier(first.summary.id)).items[0].isPreferred).toBe(false);
    expect((await buy.supplier(second.summary.id)).items[0].isPreferred).toBe(true);
  });

  test('a link can be removed after a confirmation', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    await buy.link(item.id, supplier.summary.id);

    const page = await signIn('admin');
    const details = new SupplierDetailsPage(page);
    await details.open(supplier.summary.id);
    await details.itemRow(item.name).getByRole('button', { name: 'Remove' }).click();
    await expect(details.confirm).toBeVisible();
    await details.confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(details.itemRow(item.name)).toBeVisible();

    await details.itemRow(item.name).getByRole('button', { name: 'Remove' }).click();
    await details.confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(details.itemRow(item.name)).toHaveCount(0);
    expect((await buy.supplier(supplier.summary.id)).items).toHaveLength(0);
  });

  test('a deactivated supplier leaves the list until inactive ones are shown, and can be restored', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();

    const page = await signIn('admin');
    const details = new SupplierDetailsPage(page);
    await details.open(supplier.summary.id);
    await details.deactivate.click();
    await details.confirm.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(details.restore).toBeVisible();

    const suppliers = new SuppliersPage(page);
    await suppliers.open();
    await suppliers.search.fill(supplier.summary.name);
    await expect(suppliers.row(supplier.summary.name)).toHaveCount(0);
    await suppliers.setShowInactive(true);
    await expect(suppliers.row(supplier.summary.name)).toContainText('Inactive');

    await details.open(supplier.summary.id);
    await details.restore.click();
    await expect(details.deactivate).toBeVisible();
    expect((await buy.supplier(supplier.summary.id)).summary.isActive).toBe(true);
  });

  test('an inactive supplier cannot be linked to new items or receive stock', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    await api.client.call('owner', 'POST', `suppliers/${supplier.summary.id}/deactivate`);

    const link = await api.client.call('owner', 'PUT', `items/${item.id}/suppliers/${supplier.summary.id}`, {
      body: { packName: 'box', unitsPerPack: 1, packPrice: 1, isPreferred: false },
    });
    expect(link.status()).toBe(400);
    const receipt = await buy.receive(supplier.summary.id, [{ itemId: item.id, packs: 1 }]);
    expect(receipt.status()).toBe(400);
  });

  for (const role of ['admin', 'stockmgr', 'viewer', 'cashier', 'itemmgr'] as Role[]) {
    test(`who may use suppliers: ${role}`, async ({ api }) => {
      const canRead = (GROUPS.suppliersRead as readonly Role[]).includes(role);
      const canWrite = (GROUPS.suppliersWrite as readonly Role[]).includes(role);
      const list = await api.client.call(role, 'GET', 'suppliers');
      expect(list.ok(), `${role} read`).toBe(canRead);
      const create = await api.client.call(role, 'POST', 'suppliers', { body: { name: unique('Role check') } });
      expect(create.ok(), `${role} write`).toBe(canWrite);
      if (!canRead) {
        expect([401, 403]).toContain(list.status());
      }
    });
  }

  test('roles that cannot read costs never get pack prices', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem();
    await buy.link(item.id, supplier.summary.id, { packPrice: 840 });

    const asStockManager = await api.client.json<{ items: { packPrice: number | null; unitCost: number | null }[] }>(
      'stockmgr', 'GET', `suppliers/${supplier.summary.id}`,
    );
    expect(asStockManager.items[0].packPrice).toBeNull();
    expect(asStockManager.items[0].unitCost).toBeNull();
    const asViewer = await api.client.json<{ items: { packPrice: number | null }[] }>('viewer', 'GET', `suppliers/${supplier.summary.id}`);
    expect(asViewer.items[0].packPrice).toBe(840);
  });

  test('a viewer sees the list but no add button, and a cashier is turned away from the page', async ({ signIn }) => {
    const viewer = await signIn('viewer');
    const suppliers = new SuppliersPage(viewer);
    await suppliers.open();
    await expect(suppliers.addButton).toHaveCount(0);

    const cashier = await signIn('cashier');
    await cashier.goto('/management/setup/suppliers');
    await expect(cashier).not.toHaveURL(/setup\/suppliers/);
  });
});
