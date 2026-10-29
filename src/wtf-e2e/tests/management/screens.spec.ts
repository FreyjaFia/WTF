import { APIResponse } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ManagementExtraApi } from '@api/management-extra';
import { ROUTES } from '@data/routes';
import { CustomerEditorPage, DetailsActions, ManagementListPage, ProductEditorPage, SidebarPage } from '@pages/management.page';
import { go } from '@utils/navigation';
import { unique, uniqueCode } from '@utils/unique';

const LONG_NAME: string = 'N'.repeat(101);

function mx(api: Api): ManagementExtraApi {
  return new ManagementExtraApi(api.client);
}

async function expectRejected(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), `${label}: ${await response.text()}`).toBe(400);
}

test.describe('management screens @management', () => {
  const LISTS: ReadonlyArray<{ readonly entry: string; readonly path: string }> = [
    { entry: 'Products', path: ROUTES.products },
    { entry: 'Customers', path: ROUTES.customers },
    { entry: 'Users', path: ROUTES.users },
    { entry: 'Promotions', path: ROUTES.promotions },
  ];
  for (const list of LISTS) {
    test(`admin opens ${list.entry} from the sidebar`, async ({ signIn }) => {
      const page = await signIn('admin', { landing: true });

      await new SidebarPage(page).link(list.path).click();

      await expect(page).toHaveURL(new RegExp(`${list.path}$`));
    });
  }

  test('the New Product editor saves a product that then shows in the list', async ({ api, signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new ProductEditorPage(page);
    const name = unique('UI Drink');
    const code = uniqueCode('U');
    await editor.openNew();

    await editor.name.fill(name);
    await editor.code.fill(code);
    await editor.price.fill('55.50');
    await editor.submit.click();

    await expect(page).toHaveURL(/\/management\/products\/details\/[0-9a-f-]{36}$/);
    const saved = (await mx(api).list(`products?searchTerm=${encodeURIComponent(name)}`)).find((product) => product.code === code);
    expect(saved).toBeDefined();
    expect((await api.products.get(saved!.id)).price).toBe(55.5);
    const list = new ManagementListPage(page, ROUTES.products);
    await list.open();
    await list.find(name);
    await expect(list.row(name)).toBeVisible();
  });

  test('the product editor shows messages for an empty name and a 101 character name', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new ProductEditorPage(page);
    await editor.openNew();

    await editor.name.focus();
    await editor.name.blur();
    await expect(editor.errorText(/name is required/i)).toBeVisible();
    await editor.name.fill(LONG_NAME);
    await editor.name.blur();
    await expect(editor.errorText(/cannot exceed 100 characters/i)).toBeVisible();
    await expect(editor.submit).toBeDisabled();
  });

  test('the New Customer editor saves a customer', async ({ api, signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new CustomerEditorPage(page);
    const firstName = unique('UICust');
    await editor.openNew();

    await editor.firstName.fill(firstName);
    await editor.lastName.fill('Screen');
    await editor.contact.fill('0917 123 4567');
    await editor.address.fill('3 Screen Street');
    await editor.submit.click();

    await expect(page).toHaveURL(/\/management\/customers\/details\/[0-9a-f-]{36}$/);
    const saved = await mx(api).list(`customers?searchTerm=${encodeURIComponent(firstName)}`);
    expect(saved).toHaveLength(1);
  });

  test('the customer editor keeps Create disabled for an empty name and a bad contact number', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new CustomerEditorPage(page);
    await editor.openNew();

    await editor.firstName.focus();
    await editor.firstName.blur();
    await expect(editor.errorText(/first name is required/i)).toBeVisible();
    await editor.firstName.fill('Valid');
    await editor.lastName.fill('Name');
    await expect(editor.submit).toBeEnabled();
    await editor.contact.fill('abc');
    await expect(editor.submit).toBeDisabled();
  });

  test('delete asks for confirmation, Cancel keeps the product, confirming deletes it and Restore brings it back', async ({ api, signIn }) => {
    const product = await api.products.create();
    const page = await signIn('admin');
    const actions = new DetailsActions(page);
    await go(page, `/management/products/details/${product.id}`);

    await actions.deleteButton.click();
    await expect(actions.dialog).toContainText('Delete Product?');
    await actions.dialogButton('Cancel').click();
    await expect(actions.dialog).toHaveCount(0);
    expect((await api.products.get(product.id)).isActive).toBe(true);

    await actions.deleteButton.click();
    await actions.dialogButton('Delete Product').click();
    // After a delete the app goes back to the list; the details page then offers Restore.
    await expect(page).toHaveURL(/\/management\/products$/);
    expect((await api.products.get(product.id)).isActive).toBe(false);
    await go(page, `/management/products/details/${product.id}`);
    await expect(actions.restoreButton).toBeVisible();
    await expect(actions.inactiveBadge).toBeVisible();

    await actions.restoreButton.click();
    await expect(actions.dialog).toContainText('Restore Product?');
    await actions.dialogButton('Restore Product').click();
    await expect(actions.deleteButton).toBeVisible();
    expect((await api.products.get(product.id)).isActive).toBe(true);
  });

  test('a deleted product is hidden from the default product list', async ({ api, signIn }) => {
    const live = await api.products.create();
    const gone = await api.products.create({ name: unique('E2E Gone') });
    await api.products.remove(gone.id);
    const page = await signIn('admin');
    const list = new ManagementListPage(page, ROUTES.products);

    await list.open();
    await list.find(live.name);
    await expect(list.row(live.name)).toBeVisible();
    await list.find(gone.name);
    await expect(list.row(live.name)).toHaveCount(0);
    await expect(list.row(gone.name)).toHaveCount(0);
  });

  test('customer delete asks for confirmation and Cancel keeps the customer', async ({ api, signIn }) => {
    const customer = await api.customers.create();
    const page = await signIn('admin');
    const actions = new DetailsActions(page);
    await go(page, ROUTES.customerDetails(customer.id));

    await actions.deleteButton.click();
    await expect(actions.dialog).toContainText('Delete Customer?');
    await actions.dialogButton('Cancel').click();

    await expect(actions.dialog).toHaveCount(0);
    expect((await mx(api).list(`customers?searchTerm=${customer.firstName}`)).map((c) => c.id)).toContain(customer.id);
  });

  test('a read-only Admin Viewer sees no Edit or Delete on a product', async ({ api, signIn }) => {
    const product = await api.products.create();
    const page = await signIn('viewer');
    const actions = new DetailsActions(page);

    await go(page, `/management/products/details/${product.id}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(product.name);
    await expect(actions.deleteButton).toHaveCount(0);
    await expect(actions.editLink).toHaveCount(0);
  });
});
