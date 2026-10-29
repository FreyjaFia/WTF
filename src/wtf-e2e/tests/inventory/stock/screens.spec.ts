import { StockExtraApi, linkAddOnsReliably } from '@api/stock-extra';
import { AddOnType, OrderStatus } from '@data/enums';
import { ROUTES } from '@data/routes';
import { expect, test } from '@fixtures/index';
import { ItemLifecyclePage } from '@pages/item-lifecycle.page';
import { NeedsAttentionPage } from '@pages/needs-attention.page';
import { NotificationBell } from '@pages/notification-bell.page';
import { OrderEditorPage } from '@pages/order-editor.page';
import { StockInPage } from '@pages/stock-in.page';
import { AttentionTiles, CoveragePage } from '@pages/stock-pages-extra.page';
import { go } from '@utils/navigation';
import { unique } from '@utils/unique';

const LEVELS = { warningQuantity: 20, criticalQuantity: 5 } as const;

test.describe('Needs Attention tiles and live counts @stock @attention', () => {
  test('the Out, Critical and Low tiles each filter the list to their own items', async ({ api, signIn }) => {
    const extra = new StockExtraApi(api.client);
    const out = await api.items.create({ startingQuantity: 50, ...LEVELS });
    const critical = await api.items.create({ startingQuantity: 50, ...LEVELS });
    const low = await api.items.create({ startingQuantity: 50, ...LEVELS });
    await extra.adjustRaw(out.id, { countedQuantity: 0, reason: 'Lost' });
    await extra.adjustRaw(critical.id, { countedQuantity: 3, reason: 'Lost' });
    await extra.adjustRaw(low.id, { countedQuantity: 15, reason: 'Lost' });

    const page = await signIn('admin');
    const attention = new NeedsAttentionPage(page);
    const tiles = new AttentionTiles(page);
    await attention.open();
    await expect(tiles.row(out.name)).toBeVisible();
    await expect(tiles.row(critical.name)).toBeVisible();
    await expect(tiles.row(low.name)).toBeVisible();
    await expect(tiles.row(out.name)).toHaveAttribute('data-status', 'OutOfStock');
    await expect(tiles.row(critical.name)).toHaveAttribute('data-status', 'Critical');
    await expect(tiles.row(low.name)).toHaveAttribute('data-status', 'Warning');

    await tiles.out.click();
    await expect(tiles.out).toHaveAttribute('aria-pressed', 'true');
    await expect(tiles.row(out.name)).toBeVisible();
    await expect(tiles.row(critical.name)).toHaveCount(0);
    await expect(tiles.row(low.name)).toHaveCount(0);

    await tiles.critical.click();
    await expect(tiles.row(critical.name)).toBeVisible();
    await expect(tiles.row(out.name)).toHaveCount(0);
    await expect(tiles.row(low.name)).toHaveCount(0);

    await tiles.low.click();
    await expect(tiles.row(low.name)).toBeVisible();
    await expect(tiles.row(out.name)).toHaveCount(0);
    await expect(tiles.row(critical.name)).toHaveCount(0);
  });

  test('a row appears and the sidebar count shows without a reload, then the row leaves after a stock-in', async ({ api, signIn }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 100, ...LEVELS });
    const page = await signIn('admin');
    const attention = new NeedsAttentionPage(page);
    const tiles = new AttentionTiles(page);
    await attention.open();
    await expect(tiles.row(item.name)).toHaveCount(0);

    await extra.adjustRaw(item.id, { countedQuantity: 4, reason: 'Lost' });
    await expect(tiles.row(item.name)).toBeVisible();
    await expect(tiles.row(item.name)).toHaveAttribute('data-status', 'Critical');
    await expect(tiles.sidebarBadge).toBeVisible();

    await api.items.stockIn(item.id, 200);
    await expect(tiles.row(item.name)).toHaveCount(0);
  });

  test('adding stock from the page itself clears the row without a reload', async ({ api, signIn }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 100, ...LEVELS });
    await extra.adjustRaw(item.id, { countedQuantity: 10, reason: 'Lost' });

    const page = await signIn('admin');
    const stockIn = new StockInPage(page);
    const attention = new NeedsAttentionPage(page);
    await attention.open();
    await expect(attention.row(item.name)).toBeVisible();

    await attention.row(item.name).getByTestId('add-stock').click();
    await stockIn.quantity.fill('500');
    await stockIn.submit.click();
    await expect(stockIn.recent).toContainText(item.name);

    await go(page, ROUTES.attention);
    await expect(attention.row(item.name)).toHaveCount(0);
  });

  test('a viewer sees the list but no Add Stock button', async ({ api, signIn }) => {
    const extra = new StockExtraApi(api.client);
    const item = await api.items.create({ startingQuantity: 100, ...LEVELS });
    await extra.adjustRaw(item.id, { countedQuantity: 10, reason: 'Lost' });

    const page = await signIn('viewer');
    const attention = new NeedsAttentionPage(page);
    await attention.open();
    await expect(attention.row(item.name)).toBeVisible();
    await expect(attention.row(item.name).getByTestId('add-stock')).toHaveCount(0);
  });
});

test.describe('the stock label at the register @stock @orders', () => {
  test('lowering the quantity clears the label and the banner and enables checkout', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 80 });
    const item = await api.items.create({ startingQuantity: 1, allowNegativeStock: false });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();
    await editor.addProduct(drink.name, 2);

    await expect(editor.stockBanner).toContainText('Not enough stock to check out');
    const note = page.locator('[data-stock-note]').locator('visible=true').first();
    await expect(note).toContainText(item.name);
    await expect(note).toContainText('left, needs 2');
    await expect(editor.checkoutButton).toBeDisabled();

    await page.getByRole('button', { name: 'Decrease quantity', exact: true }).locator('visible=true').first().click();
    await expect(editor.stockBanner).toHaveCount(0);
    await expect(page.locator('[data-stock-note]')).toHaveCount(0);
    await expect(editor.checkoutButton).toBeEnabled();
  });

  test('saving an open order is never blocked by the stock label', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 80 });
    const item = await api.items.create({ startingQuantity: 1, allowNegativeStock: false });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();
    await editor.addProduct(drink.name, 3);
    await expect(editor.checkoutButton).toBeDisabled();

    const save = page.getByRole('button', { name: 'Save', exact: true }).locator('visible=true').first();
    await expect(save).toBeEnabled();
    await save.click();

    await expect
      .poll(async () => (await api.orders.withStatusContaining(OrderStatus.Pending, drink.id)).length, { timeout: 30_000 })
      .toBe(1);
    expect(await api.items.balance(item.id)).toBe(1);
  });

  test('products that share one blocking item are summed across cart lines', async ({ api, signIn }) => {
    const first = await api.products.create({ price: 100, name: unique('E2E Share A') });
    const second = await api.products.create({ price: 60, name: unique('E2E Share B') });
    const cup = await api.items.create({ startingQuantity: 3, allowNegativeStock: false });
    await api.items.linkProducts(cup.id, [
      { productId: first.id, quantityPerSale: 1 },
      { productId: second.id, quantityPerSale: 1 },
    ]);

    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();
    await editor.addProduct(first.name, 2);
    await expect(editor.stockBanner).toHaveCount(0);
    await expect(editor.checkoutButton).toBeEnabled();

    await editor.addProduct(second.name, 2);
    await expect(editor.stockBanner).toBeVisible();
    await expect(page.locator('[data-stock-note]').locator('visible=true').first()).toContainText('left, needs 4');
    await expect(editor.checkoutButton).toBeDisabled();
  });
});

test.describe('the Stock In page @stock @stock-in', () => {
  test('the search narrows the grid and the presets add to the quantity', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 10, unitName: 'milliliter' });
    const other = await api.items.create({ startingQuantity: 10, unitName: 'milliliter' });
    const page = await signIn('admin');
    const stockIn = new StockInPage(page);

    await stockIn.open();
    await stockIn.search.fill(item.name);
    await expect(stockIn.tile(item.name)).toBeVisible();
    await expect(stockIn.tile(other.name)).toHaveCount(0);
    await stockIn.tile(item.name).click();

    const presets = page.getByTestId('preset');
    await expect(presets).toHaveText(['+100', '+500', '+1,000', '+5,000']);
    await presets.nth(0).click();
    await presets.nth(1).click();
    await expect(stockIn.quantity).toHaveValue('600');
    await expect(stockIn.balanceAfter).toContainText('610');
  });

  test('a piece item offers small presets', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 10, unitName: 'piece' });
    const page = await signIn('admin');
    const stockIn = new StockInPage(page);

    await stockIn.open(item.id);
    await expect(page.getByTestId('preset')).toHaveText(['+1', '+5', '+10', '+50']);
  });

  test('a quantity of zero is not accepted and nothing is added', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 10 });
    const page = await signIn('admin');
    const stockIn = new StockInPage(page);

    await stockIn.open(item.id);
    await stockIn.quantity.fill('0');
    await stockIn.submit.click();

    await expect(page.getByText('Enter a quantity above zero.')).toBeVisible();
    await expect(stockIn.recent).toHaveCount(0);
    expect(await api.items.balance(item.id)).toBe(10);
  });

  test('cost and note are saved with the movement and the cost becomes the item cost', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 10, costPrice: 5 });
    const page = await signIn('admin');
    const stockIn = new StockInPage(page);
    const note = unique('Invoice');

    await stockIn.open(item.id);
    await stockIn.quantity.fill('20');
    await page.locator('#stock-in-cost').fill('12.5');
    await stockIn.notes.fill(note);
    await stockIn.submit.click();
    await expect(stockIn.recent).toContainText(item.name);

    expect(await api.items.balance(item.id)).toBe(30);
    const movement = (await api.items.movements(item.id)).find((row) => row.notes === note);
    expect(movement).toBeDefined();
    expect(movement?.quantityDelta).toBe(20);
    const extra = new StockExtraApi(api.client);
    expect((await extra.fullItem(item.id)) as unknown as { costPrice: number }).toMatchObject({ costPrice: 12.5 });
  });

  test('Added just now keeps the last five deliveries, newest first', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 0, unitName: 'piece' });
    const page = await signIn('admin');
    const stockIn = new StockInPage(page);
    await stockIn.open();

    for (let delivery = 1; delivery <= 6; delivery++) {
      await stockIn.search.fill(item.name);
      await stockIn.tile(item.name).click();
      await stockIn.quantity.fill(String(delivery));
      await stockIn.submit.click();
      await expect(stockIn.recent.locator('li')).toHaveCount(Math.min(delivery, 5));
      await expect(stockIn.recent.locator('li').first()).toContainText(`+${delivery} pc`);
    }

    await expect(stockIn.recent.locator('li').last()).toContainText('+2 pc');
    expect(await api.items.balance(item.id)).toBe(21);
  });

  test('an item manager is kept off Stock In', async ({ signIn }) => {
    const page = await signIn('itemmgr');
    await go(page, ROUTES.stockIn);
    await expect(page).not.toHaveURL(/\/inventory\/stock-in/);
  });
});

test.describe('Stock Coverage page @stock @coverage', () => {
  test('an admin sees status chips, the missing size and a Set up stock link', async ({ api, signIn }) => {
    const drink = await api.products.create({ name: unique('E2E Cov Partial') });
    const sizeA = await api.products.create({ isAddOn: true, price: 10, name: unique('E2E CovS') });
    const sizeB = await api.products.create({ isAddOn: true, price: 20, name: unique('E2E CovL') });
    await linkAddOnsReliably(api.client, drink.id, [
      { addOnId: sizeA.id, addOnType: AddOnType.Size },
      { addOnId: sizeB.id, addOnType: AddOnType.Size },
    ]);
    const covered = await api.products.create({ name: unique('E2E Cov Ok') });
    const none = await api.products.create({ name: unique('E2E Cov None') });
    const item = await api.items.create();
    await api.items.linkProducts(item.id, [
      { productId: sizeA.id, quantityPerSale: 1 },
      { productId: covered.id, quantityPerSale: 1 },
    ]);

    const page = await signIn('admin');
    const coverage = new CoveragePage(page);
    await coverage.open();

    await coverage.search.fill(drink.name);
    await expect(coverage.row(drink.name)).toContainText('Some options missing');
    await expect(coverage.row(drink.name).getByTestId('missing-options')).toContainText(sizeB.name);
    await expect(coverage.row(drink.name).getByTestId('missing-options')).not.toContainText(sizeA.name);
    await expect(coverage.row(drink.name).getByRole('link', { name: 'Set up stock' })).toHaveAttribute(
      'href',
      new RegExp(`/management/products/edit/${drink.id}`),
    );

    // Products that already take stock only show under All products.
    await coverage.showAll.click();
    await coverage.search.fill(covered.name);
    await expect(coverage.row(covered.name)).toContainText('Takes stock');

    await coverage.search.fill(none.name);
    await expect(coverage.row(none.name)).toContainText('Takes no stock');
  });

  test('a viewer sees the same chips but a View product link instead of Set up stock', async ({ api, signIn }) => {
    const none = await api.products.create({ name: unique('E2E Cov View') });

    const page = await signIn('viewer');
    const coverage = new CoveragePage(page);
    await coverage.open();
    await coverage.search.fill(none.name);

    await expect(coverage.row(none.name)).toContainText('Takes no stock');
    await expect(coverage.row(none.name).getByRole('link', { name: 'View product' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Set up stock' })).toHaveCount(0);
  });

  test('the Needs setup view hides covered products and All products shows them', async ({ api, signIn }) => {
    const covered = await api.products.create({ name: unique('E2E Cov Hidden') });
    const item = await api.items.create();
    await api.items.linkProducts(item.id, [{ productId: covered.id, quantityPerSale: 1 }]);

    const page = await signIn('admin');
    const coverage = new CoveragePage(page);
    await coverage.open();
    await coverage.search.fill(covered.name);
    await expect(coverage.row(covered.name)).toHaveCount(0);
    await expect(page.getByTestId('coverage-empty')).toBeVisible();

    await coverage.showAll.click();
    await expect(coverage.row(covered.name)).toBeVisible();
  });
});

test.describe('item list and details lifecycle in the UI @stock @items', () => {
  test('the item list finds an item by SKU and shows an Inactive badge after it is deleted', async ({ api, signIn }) => {
    const extra = new StockExtraApi(api.client);
    const sku = `UI${Date.now().toString(36)}`.toUpperCase();
    const created = await (await extra.createItemRaw({ sku })).json();
    await api.items.remove(created.id);

    const page = await signIn('admin', { landing: true });
    const list = new ItemLifecyclePage(page);
    await list.openList();
    await list.listSearch.fill(sku);

    await expect(page.getByLabel(`View details for ${created.name}`).first()).toBeVisible();
    await expect(list.inactiveBadge.locator('visible=true').first()).toBeVisible();
  });

  test('deleting asks first, cancelling keeps the item, confirming makes it inactive, and Restore brings it back', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 12 });
    const page = await signIn('admin');
    const details = new ItemLifecyclePage(page);
    await details.open(item.id);

    await details.deleteButton.click();
    await expect(details.dialog).toContainText('Delete Item?');
    await expect(details.dialog).toContainText(item.name);
    await details.confirmIn('Cancel').click();
    await expect(details.dialog).toHaveCount(0);
    expect((await api.items.get(item.id)).isActive).toBe(true);

    await details.deleteButton.click();
    await details.confirmIn('Delete Item').click();
    // After a delete the app goes back to the list; the details page then offers Restore.
    await expect(page).toHaveURL(/\/inventory\/items$/);
    await expect.poll(async () => (await api.items.get(item.id)).isActive).toBe(false);
    await details.open(item.id);
    await expect(details.restoreButton).toBeVisible();
    await expect(details.adjustButton).toHaveCount(0);

    await details.restoreButton.click();
    await expect(details.dialog).toContainText('Restore Item?');
    await details.confirmIn('Restore Item').click();
    await expect.poll(async () => (await api.items.get(item.id)).isActive).toBe(true);
    await expect(details.deleteButton).toBeVisible();
    expect(await api.items.balance(item.id)).toBe(12);
  });

  test('deleting an item a product still uses shows the refusal with the count and keeps the item active', async ({ api, signIn }) => {
    const drink = await api.products.create();
    const item = await api.items.create({ startingQuantity: 12 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 1 }]);

    const page = await signIn('admin');
    const details = new ItemLifecyclePage(page);
    await details.open(item.id);
    await details.deleteButton.click();
    await details.confirmIn('Delete Item').click();

    await expect(page.getByText(/still used by 1 product/)).toBeVisible();
    expect((await api.items.get(item.id)).isActive).toBe(true);
  });

  test('a viewer can read an item page but sees no write buttons', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 12 });
    const page = await signIn('viewer');
    const details = new ItemLifecyclePage(page);
    await details.open(item.id);

    await expect(page.getByText('Current Stock')).toBeVisible();
    await expect(details.deleteButton).toHaveCount(0);
    await expect(details.editButton).toHaveCount(0);
    await expect(details.adjustButton).toHaveCount(0);
    await expect(page.getByTestId('record-waste-button')).toHaveCount(0);
  });
});

test.describe('the bell @stock @notifications', () => {
  test('a low-stock alert shows unread in the bell and Mark all read clears it', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, ...LEVELS });
    const page = await signIn('admin', { landing: true });
    const bell = new NotificationBell(page);
    const extra = new StockExtraApi(api.client);

    await extra.adjustRaw(item.id, { countedQuantity: 4, reason: 'Lost' });
    await expect(bell.button).toHaveAttribute('aria-label', /unread/);
    await bell.open();

    const entry = bell.panel.locator('[data-bell-item]').filter({ hasText: item.name });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('data-unread', 'true');

    await bell.panel.locator('[data-bell-mark-all]').click();
    await expect(entry).toHaveAttribute('data-unread', 'false');
    await expect(bell.panel.locator('[data-bell-mark-all]')).toBeDisabled();
  });
});
