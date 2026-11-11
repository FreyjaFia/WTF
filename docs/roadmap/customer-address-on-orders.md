## Customer address in the quick "New Customer" dialog and on the order list [Planned, 11 Nov 2026]

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

### Decisions to make first (open questions)

1. **Is Last Name removed everywhere, or only from the quick dialog?** Recommended: **only from the quick dialog.** The full
   customer editor, reports, search, receipts and the customer link keep first and last name. Removing the field everywhere is a
   much bigger change (column, validation, reports, tests, sync).
2. **What is stored as Last Name for a quick customer?** `LastName` is `NOT NULL`. Options: (a) store an empty string `''` and
   relax `EnsureValidNames` to allow it only for the quick path; (b) make the column nullable (SQL script, then `tools/dbsync.bat`)
   and the property `string?`, which touches every place that reads `LastName`; (c) store a placeholder such as a dash.
   Recommended: **(a) empty string**, no schema change, and every display uses `$"{First} {Last}".Trim()` already. This needs your
   OK because the full editor currently insists on a last name, so an edit of a quick customer would force one (see question 3).
3. **When a quick customer is opened in the full editor, is last name still required?** Recommended: make it optional in the full
   editor too, so these customers can be saved without inventing a surname.
4. **Is Address required in the quick dialog?** Recommended: **optional**, like the full editor and like contact number. Required
   would block a walk-in who just gives a name. If it must be required (for delivery shops), say so.
5. **One line or multi-line?** Recommended: a single-line input in the dialog (compact on 375px), max 300 characters; the order
   list shows it on one truncated line. A textarea is only worth it if staff paste long directions.
6. **Which address does the list show for a delivery order: the customer's saved address or the order's `DeliveryAddress`?**
   Recommended: show `DeliveryAddress` when the order has one (it is what the rider needs), otherwise the customer's saved
   address, so the two never show side by side.
7. **Length limit.** The column has no limit but the editor caps at 500 and delivery address at 300. Recommended: one rule,
   300, in `CustomerValidation` and both forms. Existing longer addresses are untouched.
8. **Non-Unicode column.** `Address` is `varchar`, so characters outside the database code page (emoji, some symbols) turn into
   `?`. Fine for Philippine addresses with accents like ñ; flag if you want `nvarchar` (a separate script, not part of this).

### Plan

**A. Quick dialog (wtf-pos)**

- `order-editor.ts`: in `createCustomerForm` replace `lastName` with `address` (not required, `Validators.maxLength(300)`); update
  `openCreateCustomerModal` reset and `saveCustomerFromModal` to send `{ firstName, lastName: '', address: address || null }`.
- `order-editor.html`: swap the Last Name input for an Address input (label "Address", placeholder "Enter address", same classes
  and `app-` styles as the First Name input; no asterisk). Keep the dialog layout, buttons and modal-stack behavior unchanged.
- `customer.service.ts` / `customer.models.ts`: `CreateCustomerRequest.lastName` stays (sent empty) unless question 2 changes it.
- Customer picker and selected-customer label (`order-editor-helpers.ts` line ~113, `order-editor.ts` line ~474) already use
  `.trim()`, so an empty last name shows cleanly. Also show the address as a muted second line in the picker row if the existing
  rows have room (confirm on 375px).

**B. API (WTF.Api)**

- `CustomerValidation`: add `NormalizeAddress` (trim, blank to null, max 300) and call it from `CreateCustomerHandler` and
  `UpdateCustomerHandler`. Relax `EnsureValidNames` per questions 2 and 3 (first name always required; last name optional but
  still max 50). Message becomes "Customer first name is required."
- **Order list data.** Add `CustomerAddress` (`string?`) to `OrderDto` (end of the parameter list, default `null`, so existing
  constructors keep compiling). Fill it in `GetPagedOrdersHandler`, `GetOrdersHandler` and `GetOrderByIdHandler` from
  `o.Customer.Address` (select the single column, no extra queries). Add it to the list search so typing part of an address finds
  the order (`o.Customer.Address.Contains(term)`), and say so in the search placeholder only if the field is shown.
- No calculation is involved, so nothing goes in `WTF.Calculations`.
- Offline: `CustomerDto` in the POS catalog already includes `address`, so no sync change. Pending and held orders keep
  `customerName`; add `customerAddress` to the IndexedDB order record (`db.ts`, `offline-order.service.ts`) so the list can show it
  while offline. A Dexie version bump is needed only if the field is indexed; a plain optional property is not.

**C. Order list (wtf-pos)**

- `order.models.ts`: add `customerAddress?: string | null` to the order list item (and `OrderDto` model).
- `order-list.html`: beside the name, show the address in `text-xs text-gray-500`, truncated, with the full text in a `title`:
  - **Desktop (1440, `lg`)**: in the Order # cell, name on one line, address on the line under it, both `truncate`.
  - **Tablet (820)**: same grid as desktop if it uses `lg` rows, otherwise the mobile layout below; check both.
  - **Phone (375)**: in mobile row 3, `Name · Address · time · items` can overflow, so put the address on its own line under the
    name, `truncate`, never wrapping the status badge.
  - Delivery orders: apply decision 6 so the address is not printed twice.
- Pending offline and held rows get the same treatment from the stored `customerAddress`.
- Show nothing (no dash, no empty line) when there is no address, so existing rows keep their height.

**D. Other screens that print the customer name (check, change only if you want it)**

Order details, receipt (`order-receipt`), staff envelope, chat drawer, reports (customers report, customer link report). The
request only names the order list; the plan leaves these alone. Order details is the natural next place for the address.

### SQL and dbsync

No schema change in the recommended path: `Address` and `LastName` already exist. If question 2 goes with a nullable
`LastName`, add `tools/sql/<date>_make_customer_last_name_optional.sql` (idempotent: only alters when the column is still
`NOT NULL`, never edits an old script), run it on the real `WTF` database (`.\SQLEXPRESS`) first, then `tools\dbsync.bat`, and
keep the scaffold output as generated (delete only a true duplicate if the build needs it, and say so). If a length limit is
added at the database level, same procedure, and the script must first check that no row is longer.

### Tests

- **WTF.Tests**: `CustomerValidation` (blank address becomes null, 301 characters refused, first name required, empty last name
  allowed on create); `CreateCustomerHandler` saves the address; `GetPagedOrdersHandler`/`GetOrdersHandler` return
  `CustomerAddress` and find an order by address text; walk-in order (no customer) returns null.
- **Angular specs**: `order-editor.spec.ts` (dialog has Address and no Last Name, saves with address, saves with address left
  blank, invalid when first name is blank); `order-list.spec.ts` (address shown beside the name, hidden when empty, delivery
  order shows `deliveryAddress` once, search by address); `customer-editor.spec.ts` if last name becomes optional.
- **Browser check** with the `playwright-skill` against a throwaway LocalDB database (never the real `WTF` one): add a quick
  customer with and without an address, see it on the list at **375, 820 and 1440** wide, long addresses truncate without
  breaking the row, and an offline-queued order shows its address too. Run with at least 3 workers, its own tag and port.

### Build order

1. Answer the questions above (at least 1 to 6).
2. API: validation, `CustomerAddress` on `OrderDto`, search, tests.
3. Quick dialog change and specs.
4. Order list display (desktop, tablet, phone), offline record, specs.
5. Browser check at 375, 820 and 1440 on the throwaway database; update this file and the status in `docs/ROADMAP.md`.
