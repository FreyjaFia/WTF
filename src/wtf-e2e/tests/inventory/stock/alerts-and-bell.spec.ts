import { expect, test } from '@fixtures/index';
import { NeedsAttentionPage } from '@pages/needs-attention.page';
import { NotificationBell } from '@pages/notification-bell.page';
import { StockInPage } from '@pages/stock-in.page';

test.describe('stock alerts, Needs Attention and the bell @stock @notifications', () => {
  test('an item that drops below its warning level appears on Needs Attention', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, warningQuantity: 20, criticalQuantity: 5 });
    await api.waste.record(item.id, { quantity: 85 });

    const page = await signIn('stockmgr');
    const attention = new NeedsAttentionPage(page);
    await attention.open();

    await expect(attention.row(item.name)).toBeVisible();
    await expect(attention.row(item.name)).toHaveAttribute('data-status', /Warning|Low/);
  });

  test('an item above its warning level is not listed', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, warningQuantity: 20, criticalQuantity: 5 });
    const page = await signIn('stockmgr');
    const attention = new NeedsAttentionPage(page);

    await attention.open();
    await expect(attention.row(item.name)).toHaveCount(0);
  });

  test('an item below its critical level is marked critical', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, warningQuantity: 20, criticalQuantity: 10 });
    await api.waste.record(item.id, { quantity: 95 });

    const page = await signIn('stockmgr');
    const attention = new NeedsAttentionPage(page);
    await attention.open();
    await expect(attention.row(item.name)).toHaveAttribute('data-status', /Critical/);
  });

  test('adding stock from Needs Attention clears the row', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, warningQuantity: 20, criticalQuantity: 5 });
    await api.waste.record(item.id, { quantity: 90 });

    const page = await signIn('admin');
    const attention = new NeedsAttentionPage(page);
    const stockIn = new StockInPage(page);

    await attention.open();
    await attention.row(item.name).getByTestId('add-stock').click();
    await stockIn.quantity.fill('200');
    await stockIn.submit.click();
    await expect.poll(() => api.items.balance(item.id)).toBe(210);

    await attention.open();
    await expect(attention.row(item.name)).toHaveCount(0);
  });

  test('the alert reaches the bell of an admin', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, warningQuantity: 20, criticalQuantity: 5 });
    const page = await signIn('admin', { landing: true });
    const bell = new NotificationBell(page);

    await api.waste.record(item.id, { quantity: 85 });
    await expect(bell.button).toHaveAttribute('aria-label', /unread/);
    await bell.open();
    await expect(bell.panel).toContainText(item.name);
  });

  test('a cashier does not get stock alerts', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, warningQuantity: 20, criticalQuantity: 5 });
    await api.waste.record(item.id, { quantity: 85 });

    const page = await signIn('cashier', { landing: true });
    const bell = new NotificationBell(page);
    await bell.open();
    await expect(bell.panel).not.toContainText(item.name);
  });
});
