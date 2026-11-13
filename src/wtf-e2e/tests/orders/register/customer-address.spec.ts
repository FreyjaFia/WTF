import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { OrderStatus } from '@data/enums';
import { OrderEditorPage } from '@pages/order-editor.page';
import { OrderListPage } from '@pages/order-list.page';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

interface SavedOrder {
  readonly id: string;
  readonly orderNumber: number;
  readonly customerName: string | null;
  readonly customerAddress: string | null;
}

test.describe('customer address on orders @orders @customer-address', () => {
  test('a quick customer needs no last name, and the order keeps its own copy of the address', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 100 });
    const first = unique('Maria Clara');
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();

    await page.getByRole('button', { name: '+ New' }).locator('visible=true').first().click();
    await expect(page.locator('#create-customer-title')).toBeVisible();
    await expect(page.getByText('Last Name')).toHaveCount(0);
    await page.getByPlaceholder('Enter first name').fill(first);
    await page.getByPlaceholder('Enter address').fill('  45 Mabini Street, Barangay San Antonio, Pasig City  ');
    await page.getByRole('button', { name: 'Save Customer' }).click();
    await expect(page.locator('#create-customer-title')).toBeHidden();

    const orderAddress = page.getByLabel('Order address').locator('visible=true').first();
    await expect(orderAddress).toHaveValue('45 Mabini Street, Barangay San Antonio, Pasig City');
    await orderAddress.fill('Blk 7 Lot 12 Rizal Avenue, Barangay Poblacion, Makati City');

    await editor.addProduct(drink.name);
    await editor.payCash(100);

    await expect.poll(async () => (await findOrder(api, first))?.customerAddress ?? null).toBe('Blk 7 Lot 12 Rizal Avenue, Barangay Poblacion, Makati City');

    const customer = await api.client.json<{ id: string; lastName: string | null; address: string | null }[]>('owner', 'GET', `customers?searchTerm=${encodeURIComponent(first)}`);
    expect(customer[0].lastName).toBeNull();
    expect(customer[0].address).toBe('45 Mabini Street, Barangay San Antonio, Pasig City');

    await api.client.json('owner', 'PUT', `customers/${customer[0].id}`, { id: customer[0].id, firstName: first, lastName: null, address: '18 Sampaguita Street, Barangay Holy Spirit, Quezon City', contactNumber: null });
    const again = await findOrder(api, first);
    expect(again?.customerAddress).toBe('Blk 7 Lot 12 Rizal Avenue, Barangay Poblacion, Makati City');
  });

  test('a customer with no address leaves the order without one', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 50 });
    const first = unique('Jose Rizal');
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();

    await page.getByRole('button', { name: '+ New' }).locator('visible=true').first().click();
    await page.getByPlaceholder('Enter first name').fill(first);
    await page.getByRole('button', { name: 'Save Customer' }).click();
    await expect(page.locator('#create-customer-title')).toBeHidden();
    await expect(page.getByLabel('Order address').locator('visible=true').first()).toHaveValue('');

    await editor.addProduct(drink.name);
    await editor.payCash(50);

    await expect.poll(async () => (await findOrder(api, first))?.orderNumber ?? 0).toBeGreaterThan(0);
    expect((await findOrder(api, first))?.customerAddress).toBeNull();
  });

  test('the order list shows the address under the customer name', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 75 });
    const customer = await api.customers.create(unique('Ana Santos'));
    const address = `${Date.now() % 9000 + 100} Mangga Street, Barangay Kapitolyo, Pasig City`;
    const response = await api.client.call('cashier', 'POST', 'orders', {
      body: { ...api.orders.body({ items: [{ productId: drink.id, quantity: 1 }], customerId: customer.id }), customerAddress: address },
    });
    expect(response.status()).toBe(201);
    const noAddress = await api.customers.create(unique('Pedro Reyes'));
    const plain = await api.client.call('cashier', 'POST', 'orders', {
      body: { ...api.orders.body({ items: [{ productId: drink.id, quantity: 1 }], customerId: noAddress.id, status: OrderStatus.Pending }), customerAddress: '' },
    });
    expect(plain.status()).toBe(201);

    const page = await signIn('admin');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await new OrderListPage(page).open();
      await expect(page.getByText(address).locator('visible=true').first(), viewport.name).toBeVisible();
      expect(overflowProblem(await measureOverflow(page)), viewport.name).toBeNull();
      await page.screenshot({ path: `test-results/customer-address-list-${viewport.width}.png` });
    }
  });
});

async function findOrder(api: Api, customerName: string): Promise<SavedOrder | undefined> {
  const orders = await api.client.json<SavedOrder[]>('owner', 'GET', 'orders');
  return orders.find((order) => order.customerName === customerName);
}
