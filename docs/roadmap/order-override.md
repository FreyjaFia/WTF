## Completed Order Override [Implemented]

Admins and above (`Admin`, `Owner`) can correct a completed order after the fact
(items, add-ons, quantities, customer, payment method / amount / tips, special instructions)
instead of only refunding it.

### Implemented

- API: `PUT /api/orders/{id}/override` behind the `OrdersOverride` policy (Owner, Admin).
  It reuses `UpdateOrderHandler` through an `IsOverride` flag that is never bound from the
  request body, so the regular update endpoint still rejects non-pending orders.
- Rules: only `Completed` orders, the order stays `Completed`, and a reason is required.
- Prices already paid are kept for lines that remain on the order (same product / bundle), so
  later promo changes do not reprice them; new or changed lines are priced as in a normal
  completed order.
- Audit: `OrderOverridden` entry with the full before / after snapshot (items, add-ons,
  payment, tips, total) and the reason, visible in Audit Logs and their exports.
- No push notification; the order-updated SignalR event still fires.
- UI: "Override Order" button on order details (hidden for other roles) opens the editor in
  override mode (`?override=1`). The footer becomes Review Payment (reuses the payment dialog
  so change and tips are recalculated) and Cancel Override. A reason dialog is shown before
  saving.
- Order details shows an "Overridden" box with the reason and time of the latest override
  (columns `Orders.OverrideReason` / `OverriddenAt`, script
  `tools/sql/20261011_add_order_override_details.sql`).

### Decisions on the earlier open questions

- No time window: Admins can override any completed order.
- Reports and receipts use the corrected values; the reason and time of the latest override are saved on the order and shown on order details, and the audit log keeps the full history.
- Online only: override is not offered for offline-created orders.

### Possible follow-ups

- None. Override rules are now covered by `UpdateOrderHandlerTests` and `UpdateOrderDatabaseTests` (override path, reason
  required, non-pending rejected), and the policy is in the route and role snapshots.

---

