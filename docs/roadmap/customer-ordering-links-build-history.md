#### Phase 1 - Data model, staff endpoints, customer details UI [Completed]

Deliverables:

- SQL script and rescaffold (columns above, `PendingApproval` status row, system user).
- `OrderStatusEnum.PendingApproval`, new audit actions/entity type, policy `OrderLinksManage`.
- `Features/OrderLinks/` handlers + endpoints (enable/disable, create, list, revoke), token
  generator, `AllowOrderingLink` on `CustomerDto`.
- Loyalty redirect `TargetType` fix.
- Frontend: `OrderLinkService`, models, messages, `OrderLinksWrite` role group, customer
  details "Ordering link" section.

Tests:

- API: `RouteTableTests.ExpectedRoutes` (add the four routes), `PolicyMatrixTests.Expected`
  (`OrderLinksManage`; `WritePolicies_NeverAdmitAdminViewer` applies), handler tests in
  `src/WTF.Tests/Features/OrderLinks/` using the in-memory `WTFDbContext` helpers in
  `src/WTF.Tests/Database` (success, customer missing/inactive/not enabled, past expiry, link of
  another customer, revoke, disable revokes all, audit entry), token generator tests (length,
  uniqueness, URL-safe), loyalty redirect ignores order tokens.
- Frontend: `order-link.service.spec.ts` (each method and error path), `customer-details.spec.ts`
  additions, `apiPolicies` entry in `app-roles.spec.ts`; `button-conventions.spec.ts` runs
  automatically.
- Note: the in-memory database does not enforce unique indexes or defaults (see the Automated
  Testing Plan limits), so token uniqueness cannot be proven there.

Done when: a Cashier can enable ordering, generate (with and without end date), copy, revoke and
disable links; an AdminViewer cannot; an order-link token returns 404 on the loyalty redirect.

#### Phase 2 - Public validation, ordering page and My orders [Completed]

Implemented: `OrderLinkAccess` (the shared token check, ordinal token compare), `GET /api/public/order-links/{token}` (+ `/orders`, `/orders/{id}`), `PublicCatalogDto` built from the loaders now shared with the POS sync (`PosCatalogLoader`), `LastUsedAt` (written at most once a minute), `order-link-policy` (per IP) plus a per-token global limiter, `Cache-Control: no-store`, the `/shop/:token` page (menu, search, categories, own add-on picker, in-memory cart, My orders with a 30 s poll), the invalid-link page and the `/public/` interceptor exclusion. The cart has no checkout yet (Phase 3). Verified harmless for a logged-out visitor: push registration only runs after login, the offline queue only syncs when authenticated, and the update banner only offers a web refresh.

- `GET /api/public/order-links/{token}` with the shared token check, `PublicCatalogDto` (extract
  the loaders from `GetPosCatalogHandler`), `LastUsedAt`, `order-link-policy`.
- Public page, invalid-link page, interceptor exclusion, route constants (see Frontend design).
- **My orders** (ships in this phase, empty until Phase 3 adds submission): the list and detail
  endpoints above. The list returns the link customer's `Source = CustomerLink` orders across
  all of that customer's links (so a regenerated link keeps the history), newest first. The page
  shows cards grouped by date with `BadgeComponent` statuses (amber for "Waiting for
  confirmation"), tap to expand details (items, add-ons, total, pickup/delivery, payment),
  `PullToRefreshComponent`, and a 30 s poll while the tab is visible (the SignalR hub needs a
  login; Phase 5 adds a customer hub).
- Tests: `RouteTableTests` (the new routes go in `OnlyTheExpectedRoutesArePublic`; they are
  GETs so the write-routes list is unaffected), token-check cases (revoked, expired, disabled,
  inactive customer, wrong `TargetType`, all identical 404), catalog contains no customers or
  audit fields, My orders only returns this customer's link orders and hides POS orders and other
  customers', status label mapping, service and page specs, `app.routes.spec.ts` still passes.

#### Phase 3 - Order submission, approval, notification [Completed]

Implemented (details; the original plan follows below):

- **Placing an order.** `POST /api/public/order-links/{token}/orders` (`SubmitPublicOrderHandler`) creates the order
  through the normal `CreateOrderCommand`, so the size/flavor/sauce and add-on rules, inactive products and the
  rest are checked in the one place that already does it. Server-only fields on the command (`ActorUserId`,
  `Source`, `OrderLinkId`, `FulfillmentType`, `DeliveryAddress`, `ContactNumber`) are `[JsonIgnore]`, so a
  signed-in caller cannot set them. The order starts as `PendingApproval` and is owned by the system user
  `customer-link`. The request carries no prices; the server works the total out from today's catalog (product
  price plus each add-on at the price set for that product) and requires a cash amount that covers it. Limits:
  30 lines per order, quantities 1-99 for items and add-ons, 20 different add-ons per item, address 300, contact
  7-30 characters (digits, spaces, + ( ) -), notes 100, cash amount at most 1,000,000, and at most 5 orders
  waiting for confirmation per customer. Repeated add-ons are merged. GCash stores no cash amount.
- **The link is re-checked right before the order is created** (`OrderLinkAccess.IsStillValidAsync`, a fresh
  yes/no query: EF would otherwise hand back the already-loaded link unchanged). `TimeProvider` is injected so
  a link expiring mid-request is testable. A link that stopped working returns the same 404 and creates nothing.
- **Approve / reject.** `POST /api/orders/{id}/approve` and `/reject` (`OrdersWrite`, so Cashier and up). Only
  `PendingApproval` orders; approve -> `Pending`, reject -> `Cancelled` with a required reason (max 500) stored in
  `Orders.RejectionReason` and shown to the customer. Both are audited (`OrderApproved` / `OrderRejected`) and
  tell open screens through SignalR. Revoking a link does not stop staff from answering orders already placed.
- **Status audit done.** Waiting orders are left out of the normal order lists (`All` and `ExcludeFinalized` both
  hide them; they come back only for `Status = PendingApproval`), the dashboard's recent orders, void (use reject)
  and edit (the update handler refuses them and refuses moving any order into the status). Staff cannot create an
  order as `PendingApproval`. The add-on unlink handlers treat them like pending orders. Reports, the dashboard
  totals and the monthly workbook already counted only Completed orders, so they needed no change.
- **Order data for staff.** `OrderDto` now carries `source`, `fulfillmentType`, `deliveryAddress`,
  `contactNumber` and `rejectionReason`.
- **Staff alerts.** `SendLinkOrderCreatedAsync` -> "New online order" to every active non-viewer staff member (the
  system user is the actor, so nobody is excluded), `type = online-order`, `path = /orders/list`. The app routes
  an `online-order` push to the orders list on every platform and never to the editor.
- **Staff screens.** Orders list: an "Awaiting approval" banner (oldest first) showing customer, pickup/delivery,
  items, contact, address, total and the change to prepare, with Accept and Reject (reject asks for a reason in
  `RejectOrderDialogComponent`); it refreshes over SignalR and a waiting order never appears in the normal list.
  Order details: an "Online order" box with handover, address, contact, what the customer will pay and the
  rejection reason, plus Accept / Reject. The editor sends a waiting order to its details page.
- **Public checkout.** `PublicCheckoutComponent`: pickup or delivery (address prefilled from the customer),
  contact number, cash (with an "I will pay with" amount, change preview and an exact-amount button) or GCash, and
  notes. It checks the same rules the server does, then the page sends the cart, clears it and opens My orders,
  where the order shows as "Waiting for confirmation". A server refusal is shown inside the checkout; an item that
  is no longer sold also refreshes the menu and cart underneath; a 404 switches to the invalid-link page.
- **Optional tip.** `SubmitPublicOrderRequest.Tips` (max 100,000, rounded to the cent, never negative, zero is none) is
  stored in `Orders.Tips` and returned to the customer; the banner and order details show it to staff.
- **Colored payment states** on the public checkout: the amount box and a status row are gray while no amount is
  typed (amount due), red as soon as the amount is too small (still needed) and green when it covers it (change to
  prepare). The logged-in checkout turns its amount box red the same way.
- **Hold to place the order.** On the public checkout, Place Order only acts when pressed and held for one second
  (`HoldButtonComponent`: a fill grows across the button, letting go early cancels and shows a reminder; it also
  works from the keyboard by holding Enter or Space), so an order is never sent by an accidental tap. The form is
  still checked when the hold completes.
- **Logged-in checkout modal restyled like the public checkout** (rounded card, header with the total, Cash / GCash
  as radio buttons, peso icon inside the amount received and tips boxes, an "Exact amount" button, the same footer).
  The "View Order" order-summary panel was removed from it, and the modal no longer takes the cart, customer name or
  order note as inputs.
- **Logged-in order screen:** product cards now show the product description under the name, like the public page.
- **Real-database tests** (`Database/OrderLinkDatabaseTests`): the link re-check query, the case-insensitive token
  match, the unique token index, column lengths, the new status row, the full submit and approve/reject flows with
  every foreign key enforced.

Not done / decided:

- A discounted-product promotion is applied when staff complete the order (as for every pending order), not at
  submit, so the total a customer sees is the base price total.
- No push to the customer (they are anonymous); they see the answer on My orders (30 s poll).
- No "order accepted / rejected" push to other staff (the banner already updates over SignalR).

Original plan:

- **Re-check the link before finalizing.** `SubmitPublicOrderHandler` resolves the link at the start (so a bad
  link fails fast with the same 404) and checks `RevokedAt`, `ExpiresAt` and the customer flags once more
  right before it sends the create-order command. If the link is no longer valid at that point it returns the
  same 404 and creates nothing. Tests: revoked or expired between the first check and the create, ordering
  disabled mid-request, and a revoked link whose earlier orders still show and are still approved or rejected
  by staff (revoking a link stops new orders, it does not cancel existing ones).
- **The checkout switches to the invalid-link page on a 404** from the submit call (and keeps nothing).

- The public page already lets a customer add toppings and extras more than once (a per-add-on quantity, same as the shop's own add-on screen; size, flavor and sauce stay pick-one). The submit request must carry that quantity per add-on (the child order item's `Quantity`, per unit of the parent), validated like any other.

- `POST /api/public/order-links/{token}/orders`: items, fulfillment, delivery address (required
  for Delivery), contact number (required), payment method, cash amount (>= server total),
  special instructions. Server recalculates everything, caps items and quantities. Creates the
  order through `CreateOrderHandler` with `PendingApproval`, `Source = CustomerLink`,
  `OrderLinkId`, created by the system user. Multiple orders per link are allowed.
- This POST is the first anonymous write route: add it to the allowed list in
  `WriteRoutes_WithoutAPolicy_AreOnlyAuthAndPushRoutes` (`RouteTableTests`).
- `approve` / `reject` endpoints (only from `PendingApproval`, reason required to reject, audited,
  SignalR `OrderUpdated` + `DashboardUpdated`).
- Push to staff for a new link order, and the shared recipient query + client routing by
  `type` (see "Push notifications" above).
- Orders list banner, status badges/filters, order details additions, the status audit above.
- Public page checkout step and the post-submit "waiting for confirmation" state on My orders.
- Tests: submit (totals, add-on rules, promotions, expired/revoked token, delivery without
  address, cash below total, multiple orders), approve/reject (wrong status, missing reason,
  role access), status audit regressions (unapproved orders excluded from reports/dashboard),
  route and policy snapshots, order-list and checkout specs.

#### Phase 4 - Reporting [Completed]

- **Reports by source.** Every report (daily sales, product sales, payments, hourly, staff) takes an optional
  `source` (`Pos` = 0, `CustomerLink` = 1; anything else is a 400). Left out it counts every order, so existing
  numbers do not change. It filters the order rows (and, for product sales, both the items and the bundles). The Excel
  and PDF exports say which source they cover in their subtitle ("Source: Shop orders" / "Customer link orders").
  The reports page has a Source select (All Orders, Shop Orders, Customer Link Orders) that counts on the Filters
  badge.
- **Orders by source.** `GET /api/orders/paged` takes `source` too. The order list's Filters drawer has a Source
  section (Shop orders, Customer link orders): one chosen asks the server for that source, both or none asks for all,
  it is remembered with the other list filters and counts on the Filters badge. Orders waiting for approval stay out of
  the normal list either way.
- **Link usage.** The customer details links list shows how many orders each link produced (`OrderLinkDto.OrdersCount`,
  whatever became of the orders) next to "Last used".
- **Monthly workbook.** Checked: it builds its sheets from the same handlers without a source, so it keeps counting
  every completed order and its labels are unchanged. Waiting, rejected and cancelled orders were already excluded
  from revenue by the status audit.
- Tests: each report limited to a source and the same totals when added up, paged orders by source (waiting orders
  stay hidden), link order counts, the report and order services' parameters, the reports page and order list
  filters, and the links list.

#### Phase 5 - Order chat (one thread per order) [Completed]

Customer and staff talk about a specific order (for example "is 5pm pickup ok?") before or after
approval.

- Database script `tools/sql/<date>_add_order_messages.sql`: `OrderMessages(Id uniqueidentifier,
  OrderId FK Orders, SenderType tinyint [Customer|Staff], SenderUserId FK Users null, Body
  nvarchar(1000), CreatedAt datetime2, ReadByStaffAt null, ReadByCustomerAt null)`, index
  `(OrderId, CreatedAt)`. Append-only; then rescaffold.
- Every customer-side write and the hub connection re-check the link (`RevokedAt`, `ExpiresAt`, customer
  flags) right before they act, like the order submit does; a revoked link also sends `LinkRevoked` and closes
  the connection.
- Rules: only for `Source = CustomerLink` orders; open while `PendingApproval` or `Pending`,
  read-only history after Completed/Cancelled/Refunded; body trimmed, 1-1000 chars, plain text
  only (never render as HTML); tighter `order-chat-policy` rate limit per token and IP.
- Sending is always a REST `POST` (validated, saved, rate limited); SignalR only delivers, so a
  hub client can never write. Audit chat open/close, not every message.
- Staff API (authenticated): `GET /api/orders/{id}/messages` (`OrdersRead`),
  `POST /api/orders/{id}/messages` and `POST /api/orders/{id}/messages/read` (`OrdersWrite`,
  AdminViewer cannot send).
- Customer API (anonymous, token check, order must belong to the customer):
  `GET`/`POST /api/public/order-links/{token}/orders/{orderId}/messages` and `POST .../read`.
- Real time, staff: reuse the authenticated `DashboardHub` (`/hubs/dashboard`) with a new
  `OrderMessageReceived` event in `HubNames.Events`.
- Real time, customer: new anonymous `CustomerOrderHub` at `/hubs/customer-orders`, mapped in
  `Program.cs` next to `DashboardHub`. The token is sent as the connection `access_token` query
  value and validated in `OnConnectedAsync` (abort on failure); the connection joins group
  `customer-{customerId}`. The server pushes `OrderMessageReceived`, `OrderStatusChanged` (so
  approve/reject shows instantly) and `LinkRevoked` (client leaves and shows the invalid-link
  page). No client-callable methods that read or write data; limit connections per IP. Keep the
  30 s poll as fallback when the socket drops. The public page needs its own SignalR client (pattern
  of `app/core/services/signalr.service.ts`, without the JWT factory).
- Push to staff on a new customer message (`order-message` type, opens the order with the chat
  open; see "Push notifications" above).
- UI: a shared presentational chat component (message bubbles + input, busy state) used in a
  `SideDrawerComponent` for staff ("Chat" button with unread badge on awaiting-approval cards and
  order details) and inside an order in My orders for the customer; unread badges on both sides.
- Tests: send/list, other customer's order 404, closed thread rejected, length limits, unread
  marking, hub connection validation (valid token joins; revoked/expired/disabled aborts),
  `RouteTableTests` (public POSTs on the write-routes list), service and component specs.

**What was built (and where it differs from the plan above).**

- **Conversations, not order threads.** The tables are `Conversations` (customer, kind `Order`/`Support`, optional order, title
  "Order #1042", last message time, closed time) and `ConversationMessages` (sender customer/staff, staff user, body 1-1000,
  read-by-staff and read-by-customer times), from `tools/sql/20261012_add_conversations.sql`. An order has at most one conversation
  (unique filtered index); it is created by the first message. Only the Order kind has screens: Support can be added later
  without a change to the tables, as its own inbox with its own access rule.
- **One shared staff inbox.** An order has no owner. A customer's message reaches every signed-in staff member who can read orders
  (live) and every active staff device except viewers (push, type `order-message`, opens the order with the chat open). Opening a
  chat or replying marks the customer's messages read for everyone; each reply shows who sent it. Admin Viewers can read but not reply.
- **API.** Staff: `GET /api/conversations` (the envelope list, unread first, with the number of unread conversations),
  `GET /api/orders/{id}/conversation`, `POST /api/orders/{id}/messages`, `POST /api/orders/{id}/messages/read`. Customer, behind the
  link: `GET .../conversations`, `GET|POST .../orders/{orderId}/messages`, `POST .../orders/{orderId}/messages/read`. Every customer
  call runs the link check, only reaches an order the customer placed through a link, and sending re-checks the link right before
  saving. A customer sees a staff member's first name only. Chat is open while the order is waiting or accepted and read-only after;
  a customer can send ten messages in a row before the shop must reply; sending has its own rate limit (`order-chat-policy`).
- **Real time uses two hubs, and the dashboard hub is unchanged.** `DashboardHub` keeps its dashboard-only policy, so cashiers (who
  answer customers) cannot connect to it. Staff chat events go through a new `StaffOrderHub` (`/hubs/staff-orders`, orders-read
  policy). Customers use `CustomerOrderHub` (`/hubs/customer-orders`): anonymous, the link token (`access_token`) is checked on
  connect and anything invalid is aborted, ten connections per address, and no method a client can call. The events only say that
  something changed (`OrderMessageReceived`, `ConversationRead`, `OrderStatusChanged`, `LinkRevoked`); the page then asks for the
  data again. Approve, reject and ready update the customer's page at once; revoking a link sends every page open through it to the
  invalid-link page.
- **Screens.** An envelope with a red unread count (conversations, not messages) in the sidebar's top row (beside the logo) and in the
  phone top bar (name, role, status and clock moved into the avatar's menu); it opens a list, unread first, and a row opens that order
  with its chat open. Staff: a Chat button with an unread badge on every waiting order, on order details and in the editor, a badge on
  list rows, and a side panel. Customer: the same envelope, a "Chat with the shop" card on an order's details, a badge on rows, and a
  chat that rises as a sheet on phones and opens as a panel on wide screens. Nothing of the chat is stored on the customer's device.
- Tests: handlers (staff and customer), rules, the notifier, both hubs, push, real SQL Server tests, route snapshots, and the services,
  chat, envelope, panels, header, sidebar and pages on the front end.

### Testing and verification

New code follows the Automated Testing Plan rules above (a handler test per handler, spec per
service/component, snapshots updated in the same change).

- `dotnet test src/WTF.Tests/WTF.Tests.csproj` and `npm test -- --watch=false` in `src/wtf-pos`.
- Run each SQL script twice against a dev database (idempotency), rescaffold, build the API.
- Manual, phase 1: enable ordering, generate with and without an end date, revoke, disable and
  see links flip to Revoked; Cashier allowed, AdminViewer blocked; loyalty redirect with an
  order-link token returns 404.
- Manual, phases 2-3: open the link on a phone-width browser while logged out, place several
  orders, see them in the Awaiting approval banner, accept one and reject another with a reason,
  check My orders shows the new statuses, check the audit log, and confirm unapproved orders are
  missing from the dashboard and report totals.
- Manual, phase 5: chat from both sides in two browsers, revoke the link while connected, check
  unread badges and the staff push.

### Order details redesign and public page addresses (19 Oct 2026)

- **Order details (POS and public) share one layout.** A top card with a status-colored strip, the order number and status badge, a large total and the plain facts (customer, items, payment, source on the POS; the status sentence on the public page). Below it, the items on the left (a plain list, no inner scroll box) and the payment summary on the right, which stays in view on wide screens. Notes use one gray "Order note" style, also for a line's own instructions; only warnings (needs review, online order, overridden) stay amber. The "2x" in front of a name is gray, also on the downloaded order summary.
- **Status colors.** One scheme on both sides: waiting amber, accepted blue, ready orange, completed green, rejected and refunded red, cancelled gray. The POS uses it through the order's status; the public page takes it from `publicStatusAccent` in `public-order-status.ts`. A refunded order is red (it was orange).
- **The heading stays put.** On the POS the heading is outside the scrolling area; on the public page it is sticky at the top of it, and the payment panel sticks just under it.
- **Public page addresses.** The page moved from `/order/:token` to `/shop/:token`, with the menu, the order list and one order as child routes (`/shop/:token`, `/shop/:token/orders`, `/shop/:token/orders/:id`) of the same page, so Back, Refresh and a shared link work, and tapping My orders returns to the list. The page reads its tab and open order from the address (`PublicOrderComponent.syncFromUrl`); `selectTab`, `openOrder` and `closeOrder` change the address. Old `/order/:token` links redirect, so nothing sent so far breaks. The database stores only the token, so no script was needed.
- **Keeping a changed number or address (20 Oct 2026).** At checkout, when the contact number (or, for a delivery, the address) differs from the one on file, one tick box under the contact number asks "Save my new number for next time" (it says "address" or "number and address" when that is what changed). It starts unticked and is not shown while the value matches what is on file. The request carries `saveContactNumber` and `saveAddress`; after the order is placed the server updates the customer (address only for a delivery, `UpdatedBy` the customer-link user, audited as `CustomerUpdated`), and a failure there never undoes the order. The page then shows the new values as the ones on file, so it asks no more.
- **The public menu groups products like the POS (20 Oct 2026).** The tabs and sections are the sub-categories (Coffee, Non-Coffee, Snacks, Retail, in that order) instead of the main categories (Drinks, Food, Desserts, Other). A product with no sub-category (or one the page does not know) is not shown, the same as on the POS editor, so give every product one. Promos still come first.
- **Small matches (20 Oct 2026).** The POS New Order screen has no back arrow (the menu already has Orders); editing an existing order keeps it. The public page header reads "POS v1.18.1", the same as the POS.
- **Orders list.** The "Awaiting approval" and the offline sync sections start collapsed ("Needs review" stays open).
- **Checked in the running app** (throwaway database, 20 products in one order, 30 more orders over many dates): both details pages at desktop, tablet and phone widths, the sticky heading, the deep link to an order, the Back button, and the date groups of My orders.

---

