import { APIResponse } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ManagementExtraApi } from '@api/management-extra';
import { ItemEditorPage } from '@pages/management.page';
import { unique } from '@utils/unique';

const LONG_NAME: string = 'N'.repeat(101);

function mx(api: Api): ManagementExtraApi {
  return new ManagementExtraApi(api.client);
}

async function expectRejected(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), `${label}: ${await response.text()}`).toBe(400);
}

test.describe('item editor @management @inventory', () => {
  test('creates an item from the screen with the chosen base unit', async ({ api, signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new ItemEditorPage(page);
    const name = unique('UI Item');
    await editor.openNew();

    await editor.name.fill(name);
    await editor.unit.selectOption('milliliter');
    await editor.startingQuantity.fill('250');
    await editor.submit.click();

    await expect(page).toHaveURL(/\/inventory\/items\/details\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop()!;
    const item = await api.client.json<{ name: string; unitName: string; currentQuantity: number }>('superadmin', 'GET', `items/${id}`);
    expect(item).toMatchObject({ name, unitName: 'milliliter', currentQuantity: 250 });
  });

  test('a missing name and a 101 character name show a message and keep Create disabled', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new ItemEditorPage(page);
    await editor.openNew();

    await editor.name.focus();
    await editor.name.blur();
    await expect(editor.errorText(/name is required/i)).toBeVisible();
    await expect(editor.submit).toBeDisabled();
    await editor.name.fill(LONG_NAME);
    await editor.name.blur();
    await expect(editor.errorText(/cannot exceed 100 characters/i)).toBeVisible();
    await expect(editor.submit).toBeDisabled();
  });

  test('the base unit is always chosen: it starts on Piece and has no empty option', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new ItemEditorPage(page);
    await editor.openNew();

    await expect(editor.unit).toHaveValue('piece');
    const values = await editor.unit.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(values).not.toContain('');
    expect(values.length).toBeGreaterThan(5);
  });

  test('leaving with unsaved changes asks first; Keep Editing stays, Discard leaves', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new ItemEditorPage(page);
    const name = unique('Unsaved');
    await editor.openNew();
    await editor.name.fill(name);

    await editor.back.click();
    await expect(editor.discardDialog).toBeVisible();
    await editor.discardDialog.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(editor.discardDialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/inventory\/items\/new$/);
    await expect(editor.name).toHaveValue(name);

    await editor.back.click();
    await editor.discardDialog.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/inventory\/items$/);
  });

  test('leaving an untouched editor does not ask', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    const editor = new ItemEditorPage(page);
    await editor.openNew();

    await editor.back.click();

    await expect(page).toHaveURL(/\/inventory\/items$/);
  });

  test('the API refuses an item with no name or a 101 character name and creates nothing', async ({ api }) => {
    const marker = unique('NoSave');
    const base = { unitName: 'piece', startingQuantity: 1, costPrice: 1, sku: marker, allowNegativeStock: true };

    const empty = await mx(api).post('items', { ...base, name: '' });
    const long = await mx(api).post('items', { ...base, name: LONG_NAME });

    await expectRejected(empty, 'empty item name');
    await expectRejected(long, 'long item name');
    const items = await api.client.json<{ items?: ReadonlyArray<{ sku?: string }> } | ReadonlyArray<{ sku?: string }>>('superadmin', 'GET', 'items');
    const rows = Array.isArray(items) ? items : ((items as { items?: ReadonlyArray<{ sku?: string }> }).items ?? []);
    expect(rows.filter((row) => row.sku === marker)).toHaveLength(0);
  });
});
