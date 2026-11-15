export function orderAddressOf(order: {
  deliveryAddress?: string | null;
  customerAddress?: string | null;
}): string | null {
  return order.deliveryAddress?.trim() || order.customerAddress?.trim() || null;
}
