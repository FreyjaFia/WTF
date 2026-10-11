export type OrdersNavSection = 'new-order' | 'orders' | null;

/**
 * Which order link of the menu a page belongs to. The order list and an order's details are Orders. The editor is New
 * Order, including when it opens an order that is still pending or an offline order: that is the screen you edit and
 * check out on, so the menu keeps pointing at where you are.
 */
export function ordersNavSection(url: string): OrdersNavSection {
  const path = url.split('#')[0].split('?')[0];

  if (path === '/orders/list' || path.startsWith('/orders/details/')) {
    return 'orders';
  }

  if (path === '/orders/editor' || path.startsWith('/orders/editor/')) {
    return 'new-order';
  }

  return null;
}
