import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { OrderStatus } from '@data/enums';
import { OrderEditorPage } from '@pages/order-editor.page';
import { OrderListPage } from '@pages/order-list.page';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

interface SavedOrder {
  readonly id: string;
  readonly customerId: string | null;
  readonly customerAddress: string | null;
}

interface SavedCustomer {
  readonly id: string;
  readonly lastName: string | null;
  readonly address: string | null;
}

function house(): string {
  return unique('Blk').replace(/^Blk /, '').toUpperCase();
}

function placedOrder(page: Page): Promise<SavedOrder> {
  return page
    .waitForResponse((response) => /\/orders\/?$/.test(response.url()) && response.request().method() === 'POST')
    .then((response) => response.json() as Promise<SavedOrder>);
}

test.describe('customer address on orders @orders @customer-address', () => {
  test('a quick customer needs no last name, and the order keeps its own copy of the address', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 100 });
    const stamp = house();
    const saleAddress = `Blk ${stamp} Lot 12 Rizal Avenue, Barangay Poblacion, Makati City`;
    const savedAddress = `${stamp} Mabini Street, Barangay San Antonio, Pasig City`;
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();

    await page.getByRole('button', { name: '+ New' }).locator('visible=true').first().click();
    await expect(page.locator('#create-customer-title')).toBeVisible();
    await expect(page.getByText('Last Name')).toHaveCount(0);
    await page.getByPlaceholder('Enter first name').fill('Maria Clara');
    await page.getByPlaceholder('Enter address').fill(`  ${savedAddress}  `);
    const created = page.waitForResponse((response) => response.url().endsWith('/customers') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save Customer' }).click();
    const customerId = ((await (await created).json()) as SavedCustomer).id;
    await expect(page.locator('#create-customer-title')).toBeHidden();

    const orderAddress = page.getByLabel('Order address').locator('visible=true').first();
    await expect(orderAddress).toHaveValue(savedAddress);
    await orderAddress.fill(saleAddress);

    await editor.addProduct(drink.name);
    const placed = placedOrder(page);
    await editor.payCash(100);
    const orderId = (await placed).id;

    await expect.poll(async () => (await findOrder(api, orderId)).customerAddress).toBe(saleAddress);

    const customer = await api.client.json<SavedCustomer>('owner', 'GET', `customers/${customerId}`);
    expect(customer.lastName).toBeNull();
    expect(customer.address).toBe(savedAddress);

    await api.client.json('owner', 'PUT', `customers/${customerId}`, { id: customerId, firstName: 'Maria Clara', lastName: null, address: `${stamp} Sampaguita Street, Barangay Holy Spirit, Quezon City`, contactNumber: null });
    expect((await findOrder(api, orderId)).customerAddress).toBe(saleAddress);
  });

  for (const viewport of VIEWPORTS) {
    test(`the create-customer dialog and the order address field fit at ${viewport.name}`, async ({ api, signIn }) => {
      const drink = await api.products.create({ price: 60 });
      const page = await signIn('cashier');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const editor = new OrderEditorPage(page);
      await editor.open();
      await editor.addProduct(drink.name);
      const viewCart = page.getByRole('button', { name: /View Cart/ });
      if (await viewCart.isVisible()) {
        await viewCart.click();
      }

      await page.getByRole('button', { name: '+ New' }).locator('visible=true').first().click();
      const dialog = page.locator('#create-customer-title');
      await expect(dialog).toBeVisible();
      await page.getByPlaceholder('Enter first name').fill('Maria Clara de los Santos y Alcantara');
      const address = page.getByPlaceholder('Enter address');
      await address.fill(`${house()} Mabini Street, Barangay San Antonio, Pasig City, Metro Manila, Philippines`);
      await expect(address).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Save Customer' })).toBeInViewport();
      expect(overflowProblem(await measureOverflow(page)), `${viewport.name}: dialog`).toBeNull();

      await page.getByRole('button', { name: 'Save Customer' }).click();
      await expect(dialog).toBeHidden();
      const field = page.getByLabel('Order address').locator('visible=true').first();
      await expect(field).toBeVisible();
      await field.scrollIntoViewIfNeeded();
      await expect(field).toBeInViewport();
      expect(overflowProblem(await measureOverflow(page)), `${viewport.name}: order address field`).toBeNull();
    });
  }

  test('a customer with no address leaves the order without one', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 50 });
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();

    await page.getByRole('button', { name: '+ New' }).locator('visible=true').first().click();
    await page.getByPlaceholder('Enter first name').fill('Jose Rizal');
    const created = page.waitForResponse((response) => response.url().endsWith('/customers') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save Customer' }).click();
    const customerId = ((await (await created).json()) as SavedCustomer).id;
    await expect(page.locator('#create-customer-title')).toBeHidden();
    await expect(page.getByLabel('Order address').locator('visible=true').first()).toHaveValue('');

    await editor.addProduct(drink.name);
    const placed = placedOrder(page);
    await editor.payCash(50);
    const order = await findOrder(api, (await placed).id);

    expect(order.customerId).toBe(customerId);
    expect(order.customerAddress).toBeNull();
  });

  test('the order list shows the address under the customer name', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 75 });
    const address = `${house()} Mangga Street, Barangay Kapitolyo, Pasig City`;
    const customer = await api.client.json<SavedCustomer & { id: string }>('owner', 'POST', 'customers', { firstName: 'Ana', lastName: 'Santos', address, contactNumber: '09171234567' });
    const response = await api.client.call('cashier', 'POST', 'orders', {
      body: { ...api.orders.body({ items: [{ productId: drink.id, quantity: 1 }], customerId: customer.id }), customerAddress: address },
    });
    expect(response.status()).toBe(201);
    const noAddress = await api.client.json<SavedCustomer>('owner', 'POST', 'customers', { firstName: 'Pedro', lastName: 'Reyes', address: null, contactNumber: null });
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

async function findOrder(api: Api, orderId: string): Promise<SavedOrder> {
  return api.client.json<SavedOrder>('owner', 'GET', `orders/${orderId}`);
}
