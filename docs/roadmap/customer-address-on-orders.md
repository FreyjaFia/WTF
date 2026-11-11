## Customer address in the quick "New Customer" dialog and on the order list [Planned, decisions made 12 Nov 2026]

Two small changes asked for by the owner:

1. In the mini **New Customer** dialog on the order editor, replace the **Last Name** field with an **Address** field.
2. On the **order list**, show the customer's **address** beside the customer name.

No code is written yet. This file is the plan and the questions to answer first.

### What exists today (checked in the code)

- **Address is already stored.** `Customers.Address` exists (nullable, `varchar` with no length limit, non-Unicode). It flows
  through `Customer.cs`, `CustomerDto`, `CustomerMapping`, `CreateCustomerCommand(FirstName, LastName, Address, ContactNumber)`,
  `UpdateCustomerHandler`, the audit log values and the POS catalog sync (`GetPosCatalogHandler`, offline `CustomerDto`). The full
  customer editor (Management > Customers) already has an Address field (max 500 characters in the form, optional). So change 1
  needs **no new column**.
- **Last name is required everywhere.** `Customers.LastName` is `NOT NULL varchar(50)`. `CustomerValidation.EnsureValidNames`
  refuses a blank last name ("first name and last name are required"). The customer editor, `CreateCustomerHandler` and
  `UpdateCustomerHandler` all depend on it. The mini dialog (`order-editor.ts` `createCustomerForm`, `order-editor.html` around
  the "New Customer" modal, `saveCustomerFromModal`) sends only `firstName` and `lastName`.
- **The order list shows only the name.** `OrderDto` carries `CustomerName` (built as `FirstName + " " + LastName` in
  `GetPagedOrdersHandler`, `GetOrdersHandler`, `GetOrderByIdHandler`) and `DeliveryAddress`. `DeliveryAddress` is a separate
  per-order field (varchar 300) used by delivery orders and already printed under the name on the "waiting" cards. The customer's
  own saved address is not on `OrderDto`. The list rows (`order-list.html`, mobile row 3 and desktop "Order #" cell) print
  `customerName` only; list search (`order-list.ts` and `GetPagedOrdersHandler`, lines near 65) matches name and order number.
- Held and pending (offline) orders in the list store `customerName` as text in IndexedDB (`offline-order.service.ts`, `db.ts`).

### Decisions (Pogi, 12 Nov 2026)

1. **Last name is removed from the quick dialog only.** The full customer editor, reports, search, receipts and the customer
   link keep first and last name.
2. **`Customers.LastName` becomes nullable.** A quick customer is saved with no last name (`NULL`, not an empty string). SQL
   script plus `tools\dbsync.bat` (see below). Every place that reads `LastName` must tolerate `NULL`.
3. **Address is optional** in the quick dialog.
4. **The order keeps its own copy of the address.** The order list shows the address saved on the order, not the live customer
   record. At checkout the address field is pre-filled (as a placeholder/default the cashier can change) with the customer's
   saved address. Once the order is created the address is **locked**: editing the customer later never changes old orders.
5. **The only way to change a saved order's address is the Completed Order Override** (Owner and Admin, reason required,
   audited). See section B2.

Still open (small, recommendations given):

- **Which column holds the order's address?** `Orders.DeliveryAddress` (varchar 300) exists but is delivery-only. Recommended:
  a new nullable `Orders.CustomerAddress` (nvarchar(300)) that every order with a customer gets at creation, leaving
  `DeliveryAddress` as is. Alternative: reuse `DeliveryAddress` for all orders (no new column, but pickup and dine-in orders
  would then carry a "delivery" address). Needs your OK.
- **Delivery orders:** show `DeliveryAddress` if set, otherwise the order's `CustomerAddress`, so one address shows, never both.
- **Length limit:** 300 in `CustomerValidation`, the quick dialog and the checkout field (the full editor's 500 drops to 300;
  existing longer addresses are untouched).
- **Existing orders** have no copy. Recommended: leave them blank in the list (no backfill), since the customer's address today
  may differ from the one at the time of sale. Say so if you want a one-time backfill instead.
- Single-line input in the dialog and checkout; the list shows one truncated line.

### Plan

**A. Quick dialog (wtf-pos)**

- `order-editor.ts`: in `createCustomerForm` replace `lastName` with `address` (optional, `Validators.maxLength(300)`); reset
  and `saveCustomerFromModal` send `{ firstName, address: address || null }` with no last name.
- `order-editor.html`: swap the Last Name input for an Address input (label "Address", no asterisk, placeholder "Enter
  address"), same classes as the First Name input. Dialog layout, buttons and modal-stack behavior stay unchanged.
- `customer.models.ts` / `customer.service.ts`: `lastName` becomes optional on the create request and `string | null` on
  `CustomerDto`. Label helpers (`order-editor-helpers.ts` line ~113, `order-editor.ts` line ~474, others) already `.trim()`;
  make them use `[first, last].filter(Boolean).join(' ')` so a missing last name never prints "null".
- Customer picker rows: show the saved address as a muted second line if there is room (check 375px).

**B. Checkout (wtf-pos)**

- Checkout gets an optional **Address** field for the order, pre-filled with the selected customer's saved address and
  editable (changing it affects only this order, not the customer). Changing the selected customer re-fills it unless the
  cashier already typed their own. Delivery orders keep their existing delivery address field; do not show two fields.
- The create-order request carries `customerAddress`. Offline: the queued order stores it (`db.ts`, `offline-order.service.ts`),
  sync sends it unchanged.
- After the order is created the address is read-only everywhere (order details shows it as text), except through the
  override in B2.

**B2. Override of the address (completed orders)**

- The existing override (`PUT /api/orders/{id}/override`, policy `OrdersOverride`, Owner and Admin, completed orders only,
  reason required) can also change `CustomerAddress`. No new endpoint, policy or button: the override editor (`?override=1`)
  shows the same Address field as checkout, pre-filled with the order's current address (not the customer's), and the
  reason dialog is unchanged.
- `UpdateOrderHandler` applies `CustomerAddress` only when `IsOverride` is true (trimmed, blank to `NULL`, max 300); the
  regular update and every other role leave it untouched. The audit entry `OrderOverridden` records the old and new address
  in its before and after snapshot.
- Customer edits still never change an order's address; only the override does. Pending orders can be changed in the normal
  editor until they are completed.
- Offline-created orders are not offered the override (existing rule).

**C. API (WTF.Api, WTF.Domain)**

- `Customer.LastName` becomes `string?`; update `CustomerDto`, `CustomerMapping`, `CreateCustomerCommand`,
  `UpdateCustomerHandler`, the audit values, and every `FirstName + " " + LastName` projection (orders, reports, loyalty, order
  links, conversations, POS catalog sync, E2E seed in `WTF.E2E.Database`) to tolerate `NULL`. Use one shared name-joining helper
  so the rule lives in one place.
- `CustomerValidation`: `EnsureValidNames` becomes first name required, last name optional (blank to `NULL`, max 50).
  Add `NormalizeAddress` (trim, blank to `NULL`, max 300), used by create and update. The full customer editor makes last name
  optional too, so a quick customer can be edited without inventing a surname.
- `CreateOrderCommand` gets `CustomerAddress`; `CreateOrderHandler` saves the trimmed value (max 300) on the order, and if the
  request omits it for a customer order, falls back to the customer's saved address at that moment so the copy is never empty
  by accident. No handler changes it afterwards.
- `OrderDto` gets `CustomerAddress` (end of the list, default `null`), filled in `GetPagedOrdersHandler`, `GetOrdersHandler`
  and `GetOrderByIdHandler` from the order column. List search also matches the address.
- No arithmetic is involved, so nothing goes in `WTF.Calculations`.

**D. Order list (wtf-pos)**

- `order.models.ts`: add `customerAddress?: string | null`.
- `order-list.html`, beside the name, `text-xs text-gray-500`, truncated, full text in `title`:
  - **1440 (`lg`)**: Order # cell, name on the first line, address on the line under it.
  - **820**: same as 1440 if the `lg` grid is used there, otherwise the phone layout; check both.
  - **375**: the address on its own line under the name in the mobile row 3 so `Name · time · items` never overflows or
    pushes the status badge; truncate.
  - Delivery orders follow the rule above (one address only).
- Pending offline and held rows show the stored `customerAddress` the same way.
- No address means no extra line, so existing rows keep their height.

**E. Left alone unless you say otherwise**

Receipt, staff envelope, chat drawer and reports keep printing the name only. Order details shows the order's address
(natural place, one line). Say if the receipt or kitchen ticket should print it too.

### SQL and dbsync

Two changes, in one new idempotent script `tools/sql/<date>_customer_last_name_optional_and_order_address.sql` (never edit an
old script):

1. `Customers.LastName` to `NULL` only if it is still `NOT NULL`.
2. `Orders.CustomerAddress nvarchar(300) NULL` only if the column is missing. No backfill.

Run it on the real `WTF` database (`.\SQLEXPRESS`) first, then `tools\dbsync.bat`, and keep the scaffold output as generated
(delete only a true duplicate if the build needs it, and say so). The cloud copy is not the source of truth for the scaffold.
Address stays as it is (`varchar`, so characters outside the code page become `?`; the new order column is `nvarchar`).

### Tests

- **WTF.Tests**: `CustomerValidation` (first name required; blank or missing last name allowed and stored as `NULL`; address
  trimmed, blank to `NULL`, 301 characters refused); create customer without last name; update keeps `NULL`; name helper never
  prints "null"; create order stores the given address, falls back to the customer's saved one, and a later customer edit
  leaves the order's address unchanged; override changes the address, requires a reason, is refused for a non-admin, and the audit
  snapshot holds old and new values; a normal update ignores a sent address; the three order queries return `CustomerAddress` and search finds by address; a walk-in
  order returns `NULL`. Existing tests that assume a last name are updated.
- **Angular specs**: `order-editor.spec.ts` (dialog has Address and no Last Name; saves with and without address; invalid when
  first name is blank); checkout pre-fills the saved address, lets it be changed, and a changed value does not touch the
  customer; the override editor shows and saves the order's address and hides it from other roles; `order-list.spec.ts` (address beside the name, hidden when empty, delivery order shows one address, search by
  address); `customer-editor.spec.ts` (last name optional); offline queue keeps the address.
- **Browser check** with the `playwright-skill` against a throwaway LocalDB database (never the real `WTF` one): add a quick
  customer with and without an address, check out (placeholder shows the saved address, edit it, pay), see it on the list at
  **375, 820 and 1440**, edit the customer afterwards and confirm the old order's address did not change, long addresses
  truncate, and an offline-queued order shows its address. At least 3 workers, its own tag and port.

### Build order

1. Settle the small open points above (the order column is the one that matters).
2. SQL script on the real database, `tools\dbsync.bat`, nullable last name through the API and the full editor, tests.
3. Order address: create order, override of the address, `OrderDto`, search, offline record, tests.
4. Quick dialog and checkout field, specs.
5. Order list display at 375, 820, 1440, browser check on the throwaway database; update this file and `docs/ROADMAP.md`.
