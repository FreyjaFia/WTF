## Customer Ordering Links Feature [Completed]

Let selected customers place orders themselves through a personal link, without logging in
to the POS. Staff control which customers get a link and can set an end date so links expire.
Orders from a link wait for staff approval, and the customer and staff can chat about each order.

This section is written so the work can be picked up later without the original discussion:
it lists the decisions, the exact files to touch, the gotchas found while reading the code, and
the tests and checks each phase needs. Paths are relative to the repo root; `app/` means
`src/wtf-pos/src/app/`.

### Behavior

- On the **customer details page**, a staff member with the right role can:
  - enable/disable "Allow ordering link" for that customer (opt-in per customer; default off)
  - generate a link, optionally with an **end date** (no end date = never expires)
  - see existing links with status (Active / Expired / Revoked), created by, last used
  - copy, revoke, or regenerate a link ("regenerate" = revoke + create)
- Only customers with ordering enabled can have links generated.
- Opening a link shows a public ordering page (full catalog, cart, submit) scoped to that customer.
- A link can place **multiple orders** until it expires or is revoked.
- Expired, revoked, or unknown tokens show a friendly "link no longer valid" page (reuses the
  404-style layout); the response does not reveal whether the token ever existed.
- Disabling ordering for a customer immediately invalidates all of their links.

### Decisions

- **Approval:** orders from a link are created as `PendingApproval` (new order status, id 5).
  Staff **Accept** (-> `Pending`, joins the normal flow) or **Reject** (reason required ->
  `Cancelled`) from an "Awaiting approval" banner on the orders list page. `Pending` was not
  reused because it means "open POS order". Unapproved orders must not appear in sales
  totals, the dashboard, reports or the active order list (see "Status audit" below).
- **Payment:** same methods as the POS (Cash, GCash). For cash the customer enters the amount
  they will pay (`AmountReceived`), so staff know how much change to prepare. Must be >= total plus the tip.
  An optional tip for the shop can be entered (cash or GCash); it is sent as `Tips`, stored on the order, and
  shown to staff and on My orders. The cash amount must cover the total and the tip, and the change is
  `amount - total - tip`. The tip is not part of the order total.
- **Fulfillment:** the customer chooses **Pickup** or **Delivery**. Delivery needs an address
  (prefilled from the customer, editable). A contact number is required on every link order
  (customers have no phone field).
- **Catalog:** the full catalog for now, no per-customer restrictions. Bundles are not in the
  first version of the public page; discounted-product promotions still apply server side
  because the order goes through `CreateOrderHandler`.
- **Customer visibility:** the public page has a **My orders** tab listing the customer's link
  orders with a customer-facing status.
- **Chat:** one thread per order, real time over SignalR for both sides (Phase 5). The
  customer is anonymous, so the customer gets no push, only live updates in the page.
- **Notifications:** staff get a push/SignalR alert when a link order or a customer message arrives.
- **Database:** SQL Server through EF Core. There are no EF migrations: schema changes are
  hand-written idempotent scripts in `tools/sql`, then `tools/dbsync.bat` rescaffolds
  `src/WTF.Domain/Entities/*.cs` and `Data/WTFDbContext.cs` (never hand-edit
  `OnModelCreating`, only `OnModelCreatingPartial`).
- **Revoke is final.** There is no restore / un-revoke button: revoking is the "this link is compromised"
  action, and restoring would bring the same token back for anyone who still holds it. A revoked link is
  replaced by generating a new one (the old one stays dead). Disabling ordering for a customer revokes all of
  their links and re-enabling it does not bring them back. An "extend end date" for expired links is a possible
  later addition, only while ordering is enabled for the customer.
- **Out of scope for now:** the customer cancelling or editing an order, bundles on the public
  page, per-customer catalogs or prices, online payment.

### Key design decisions (read before coding)

1. **Reuse `CreateOrderHandler`** (`src/WTF.Api/Features/Orders/CreateOrderHandler.cs`) for the
   public submit, because price, promotion, add-on and required-selection validation live
   there. Follow the existing pattern of `[JsonIgnore]` command fields that the request body can
   never set (like `IsOverride` on `UpdateOrderCommand`): `ActorUserId`, `Source`, `OrderLinkId`,
   `FulfillmentType`, `DeliveryAddress`, `ContactNumber`. The handler currently reads the user from
   `HttpContext.User.GetUserId()` (line ~53) and would fail for anonymous callers, so make it
   prefer `ActorUserId`. Prices are only captured for Completed/Cancelled orders
   (`shouldCapturePrice`), so a `PendingApproval` order stores no prices and they are computed on
   read, same as `Pending`.
2. **System user.** `Orders.CreatedBy` is a required FK to Users and anonymous callers have no
   user. Seed an inactive "Customer Link" user and use its id for link orders and their audit
   entries. Login only matches active users, so it cannot be used to sign in.
   `AuditService.LogAsync` silently returns when no user id is resolved, so always pass
   `userId` explicitly for anonymous actions.
3. **Reuse `ShortLink`** with `TargetType = "CustomerOrder"` (entity
   `src/WTF.Domain/Entities/ShortLink.cs`; model config in `WTFDbContext.cs` ~784-796, unique
   index `IX_ShortLinks` on `Token`).
4. **Loyalty redirect bug to fix in Phase 1.** `RedirectToLoyaltyHandler`
   (`src/WTF.Api/Features/Loyalty/`) does not filter on `TargetType`, so an order-link token
   passed to `GET /api/loyalty/redirect/{token}` would return the customer id. Add
   `TargetType == "Loyalty"` and a regression test.
5. **Token.** 32 bytes from `RandomNumberGenerator`, base64url (~43 chars), stored as is (staff
   need Copy later), never logged. Do not reuse the 8-character `System.Random` generator in
   `GenerateShortLinkHandler`. The `Token` column is `varchar(20)` and must be widened to 64.
6. **Public catalog needs its own DTO.** `GET /api/sync/pos-catalog`
   (`Features/Sync/GetPosCatalogHandler.cs`) is authenticated, returns every active customer, and
   its `ProductDto` carries `CreatedBy`/`UpdatedBy` ids. Extract the product and add-on loaders
   (`LoadProductsAsync`, `LoadAddOnsByProductIdAsync`) so both handlers share them, and return a
   slim `PublicCatalogDto` (no customers, no audit fields). Promotions endpoints
   (`/api/pos/promotions/*`) require `OrdersWrite`, so they are not available to the public page.
7. **Uncommitted work.** When this plan was written, `CreateOrderHandler.cs`,
   `UpdateOrderHandler.cs`, `EvaluatePromotionsHandler.cs` and the test project had uncommitted
   changes in the working tree. Check `git status` first and build on top of them.

### Status audit (do this with the `PendingApproval` status)

Search every place that treats "not Completed/Cancelled" as active or open, and every status
switch, before shipping Phase 3:

- API: `GetOrdersHandler` (`ExcludeFinalized`), `GetPagedOrdersHandler`, active-orders endpoint,
  dashboard handlers, report handlers and the monthly workbook, `VoidOrderHandler`,
  `UpdateOrderHandler` (only `Pending` can be edited; `PendingApproval` must not be editable
  from the POS), push `SendOrderStatusChangedAsync`.
- Frontend: the three duplicated `getStatusVariant`/`getStatusLabel` switches in
  `app/features/orders/order-list`, `order-details` and `order-editor`; the status filter in the
  orders list; `OrderStatusEnum` in `app/shared/models/order.models.ts` (All=0, Pending=1,
  Completed=2, Cancelled=3, Refunded=4 today).
- Tests that snapshot statuses or totals.

### Database changes

`tools/sql/20261012_add_customer_ordering_links.sql` (use the next free date prefix).
Idempotent, same header and `IF COL_LENGTH(...) IS NULL` style as
`tools/sql/20261011_add_order_override_details.sql`:

- `Customers.AllowOrderingLink bit NOT NULL DEFAULT 0`
- `ShortLinks.Token` widened to `varchar(64)`; new `CreatedAt`, `CreatedBy` (FK Users),
  `RevokedAt` (null), `LastUsedAt` (null)
- `Orders`: `Source` (POS / CustomerLink, default POS), `OrderLinkId` (null FK ShortLinks),
  `FulfillmentType` (Pickup / Delivery, null for POS), `DeliveryAddress`, `ContactNumber`,
  `RejectionReason`
- `Statuses` row `PendingApproval` (id 5). The Statuses/PaymentMethods seed rows are not in
  `tools/sql`, so check the live data before assuming id 5 is free.
- Seed the inactive "Customer Link" user and expose its id (config value or a lookup by a fixed
  username) so the API can find it.
- `CI` runs scripts in order on tag builds and records them in `dbo.SchemaScriptHistory`, so
  new scripts must sort after the existing ones.

Phase 5 adds its own script (`OrderMessages`, below).

### API design

Policy `OrderLinksManage` (SuperAdmin, Admin, Cashier, same as `CustomersWrite`) in
`src/WTF.Api/Common/Auth/AppPolicies.cs` and `AppAuthorizationExtensions.cs`. Reads use
`CustomersRead`.

Staff endpoints (new `Features/OrderLinks/` slice, `Endpoints/OrderLinkEndpoints.cs`, add
`MapOrderLinks()` to the chain in `Endpoints/EndpointRegistration.cs`; all audited):

| Route | Notes |
| --- | --- |
| `PUT /api/customers/{id}/ordering-link-access` | Enable/disable. Disabling sets `RevokedAt` on all active links |
| `POST /api/customers/{id}/ordering-links` | Body `{ expiresAt? }`. Customer must exist, be active and have ordering enabled; expiry must be in the future |
| `GET /api/customers/{id}/ordering-links` | Status (Active / Expired / Revoked) computed from `RevokedAt`/`ExpiresAt`; created by; last used |
| `DELETE /api/customers/{id}/ordering-links/{linkId}` | Soft revoke, link must belong to the customer |
| `POST /api/orders/{id}/approve` | `OrdersWrite`; only from `PendingApproval`; -> `Pending` |
| `POST /api/orders/{id}/reject` | `OrdersWrite`; reason required; -> `Cancelled`, stores `RejectionReason` |

Public endpoints (anonymous; map under `/api/public`; rate limited):

| Route | Notes |
| --- | --- |
| `GET /api/public/order-links/{token}` | Validate; first name + `PublicCatalogDto`; sets `LastUsedAt` |
| `GET /api/public/order-links/{token}/orders?page&pageSize` | My orders |
| `GET /api/public/order-links/{token}/orders/{orderId}` | One order, 404 unless it belongs to this customer and has `Source = CustomerLink` |
| `POST /api/public/order-links/{token}/orders` | Submit an order |

Every public handler runs one shared token check: exists, `TargetType = "CustomerOrder"`, not
revoked, not expired, customer active, `AllowOrderingLink` true. Every failure returns the same 404.

Other API pieces:

- Enums: `OrderStatusEnum.PendingApproval = 5` (`Features/Orders/Enums/`); `AuditAction`
  gets `OrderLinkEnabled/Disabled/Created/Revoked` and `OrderApproved/Rejected`;
  `AuditEntityType` gets `OrderLink` (`Features/Audit/Enums/`).
- Add `AllowOrderingLink` to `CustomerDto` (`Features/Customers/DTOs/CustomerDto.cs`) and
  `CustomerMapping`.
- Rate limiting: add `order-link-policy` next to `loyalty-policy` in `Program.cs` (~157-170,
  fixed window per IP, plus a per-token partition). `UseRateLimiter()` runs before auth, which is
  fine for anonymous routes. The group must call `.RequireRateLimiting("order-link-policy")`.
- Public order DTO (`PublicOrderDto`): order number, created time, customer-facing status, items
  with add-ons, total, fulfillment, address, payment method and cash amount, special
  instructions, rejection reason. No staff names, user ids or audit fields. Compute totals with
  `OrderMetrics.ComputeOrderTotal` (`src/WTF.Calculations/Orders/OrderMetrics.cs`).
- Customer-facing status labels: `PendingApproval` "Waiting for confirmation", `Pending`
  "Accepted", `Completed` "Completed", `Cancelled` with a rejection reason "Rejected" (show the
  reason), other `Cancelled` "Cancelled", `Refunded` "Refunded".
- Push: `SendOrderCreatedAsync` (`Services/PushNotificationService.cs`) excludes the actor and
  AdminViewer and uses the title "New order created". Add a link-order variant ("New online
  order", path `/orders`) and, in Phase 5, a customer-message variant.
- SignalR names live in `src/WTF.Api/Hubs/HubNames.cs`; the order events use
  `DashboardViewers` group, `OrderUpdated` and `DashboardUpdated`.
- Global exception middleware maps `InvalidOperationException` and `ArgumentException` to 400
  with `{message}`, so handlers can throw those for validation. Public handlers should map
  link-state failures to 404 instead.

### Security checklist

- Tokens: 32 random bytes, never logged, same 404 for every invalid state.
- **Link state is checked on every call and again at the moment something is finalized.** Every public handler
  runs `OrderLinkAccess.ResolveAsync` first, which reads `RevokedAt` and `ExpiresAt` (and the customer's
  active / `AllowOrderingLink` flags) fresh from the database on every request; nothing about a link is
  cached or trusted from an earlier call. A write must not rely on the check made at the start of the request
  alone: the submit handler checks the link again immediately before it creates the order (so a link revoked
  or expired while the customer was filling in checkout, or while the request was being validated, cannot
  place an order), and any later write (chat message, hub connection) does the same right before it saves.
  The check compares against the current UTC time, never a client-supplied time.
- **The page treats any 404 from a public call as "link no longer valid"**: a failed menu refresh, My orders
  load, order submit or chat send switches to the invalid-link page and keeps nothing on screen, so a revoked
  link stops working mid-session instead of failing quietly.
- Rate limits per IP and per token on every public route; separate, tighter limit for chat.
- Server recalculates prices and promotions (through `CreateOrderHandler`); cap items per order
  and quantity per item; maximum text lengths for address, contact and instructions.
- Public responses never include staff names, user ids or audit data.
- The slim public catalog never includes customers or internal ids.
- All link creation, revocation, approval, rejection and link-originated orders are audited.
- CORS: policy "AllowUI" in `Program.cs` (~115-150) allows only localhost, capacitor and the two
  `*.runasp.net` hosts; the public page is served from the same host, so no change expected.
  Re-check if the link is ever served from another domain.
- The auth interceptor must not attach a bearer token to, or refresh/redirect on 401 for,
  `/public/` requests.

### Frontend design

Customer details page (`app/features/management/customers/customer-details/`):

- New "Ordering link" section after "Address" in the right-hand column, same section style
  (`border-t border-gray-100 pt-5`, heading `text-xs font-semibold tracking-wider text-gray-400 uppercase`):
  enable toggle, "Generate link" with optional end date, links table/cards (`BadgeComponent`
  status, created by, last used, Copy, Revoke). Revoke and disable go through `app-confirm-dialog`
  with `modalStack`, like the existing delete/restore dialogs. Buttons follow `docs/BUTTONS.md`
  (`app-btn ...`, explicit `type`, busy labels). Hide the section for roles without
  `OrderLinksWrite` and on inactive customers.
- New `OrderLinkService` (`app/core/services/`, pattern of `customer.service.ts`: `catchError`
  into `new Error(this.getErrorMessage(...))`, add texts to `app/core/messages`), models in
  `app/shared/models/order-link.models.ts`, `allowOrderingLink` on `CustomerDto`
  (`app/shared/models/customer.models.ts`).
- Role group `AppRoleGroups.OrderLinksWrite` in `app/shared/constants/app-roles.ts`.

Public page (`/shop/:token` (links sent as `/order/:token` before still redirect to it)): the menu is `/shop/:token`, the order list `/shop/:token/orders` and one order `/shop/:token/orders/:id` (same page, so Back, Refresh and shared links work). The old `/order/:token` redirects.

- Route placed in `app/app.routes.ts` between `login` and the layout shell, no guards; add it to
  `app/shared/constants/app-routes.ts`. `app.routes.spec.ts` requires the first route to be the
  login redirect and the last to be `**`/NotFound, so keep the public route in the middle.
- Same visual language as `app/features/orders/order-editor/order-editor.html`: product cards
  `card rounded-xl bg-white shadow-lg hover:-translate-y-0.5 hover:shadow-xl` in the grid
  `grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`, `app-btn app-btn-primary
  app-btn-lg`, `app-cart-drawer` on mobile and an aside cart on `xl`, `AddonSelectorComponent`,
  `BadgeComponent`. No sidebar, dock or header menu: a slim header (logo + "Ordering as
  {first name}") and a Menu / My orders tab switch.
- The order editor (3000+ lines) is tied to `AuthService`, `OfflineOrderService`,
  `CatalogCacheService` and `CartPersistenceService`, so it is not reused whole. There is no
  standalone product-card component; extract one (and the checkout form) only if the change is
  small, otherwise copy the same classes. `AddonSelectorComponent` reads add-ons through
  `CatalogCacheService.getAddOnsForProduct`, so give it an input for add-ons or build a small
  public variant. `checkout-modal` is the best base for the payment step: it already has the
  Cash/GCash toggle, amount received and change; add Pickup/Delivery, address and contact, hide tips.
- Do not use the offline stack on this page (no Dexie cart, no queue): the customer must be online.
- **No local copy of the catalog.** The page never uses `CatalogCacheService`, `ImageCacheService` or any
  IndexedDB/localStorage copy of products, prices or the cart, so a customer cannot order from an obsolete
  list. It loads the catalog fresh on every page load and every return to the Menu tab. Public API responses
  send `Cache-Control: no-store`, and the service worker (`ngsw-config.json`) has no data groups, so it never
  caches them. The server still revalidates every product, add-on and price on submit (Phase 3) and rejects
  inactive or missing ones.
- `app/app.ts` eagerly injects `PushNotificationService` and `OfflineOrderService` and
  `app.html` mounts global alert, update-banner and exit-confirm components. Check they are
  harmless for a logged-out visitor.
- Invalid link page modeled on `features/not-found` (centered card, logo, message).
- Add a `/public/` exclusion to `app/core/interceptors/auth.interceptor.ts`.

```
Mobile                                   Desktop (xl)
+---------------------------+            +-----------------------------+--------------+
| [logo]  Ordering as Maria |            | [logo]  Ordering as Maria   |  Your order  |
| [Menu] [My orders]        |            | [Menu] [My orders]          |  2x Latte    |
| [search..................]|            | [search.................... ]|  1x Croissant|
| (All)(Coffee)(Food)(...)  |            | (All)(Coffee)(Food)(...)    |  ----------  |
| +----------+ +----------+ |            | +------+ +------+ +------+  |  Total       |
| | Latte    | | Croissant| |            | | card | | card | | card |  |  [Checkout]  |
| | PHP150 + | | PHP120 + | |            | +------+ +------+ +------+  |              |
| +----------+ +----------+ |            +-----------------------------+--------------+
| [ View order (3) PHP420 ] |  <- sticky button opens the cart drawer

Checkout: ( ) Pickup ( ) Delivery -> address | Contact number (required)
          Payment [Cash] [GCash]; Cash: "I will pay with PHP ____" -> change staff prepare
          Special instructions | [ Place order ] -> My orders tab, "waiting for confirmation"
```

Orders list (`app/features/orders/order-list/`): amber "Awaiting approval" banner at the top,
styled like the pending-offline block (`order-list.html` ~185-240): customer, pickup/delivery,
contact, total and the change to prepare, with Accept / Reject buttons; reject opens a reason
dialog. New status in the badges and filter. Order details shows fulfillment, address, contact,
source, rejection reason. SignalR `OrderUpdated` (already handled by `OrderList`) refreshes the list.

### Push notifications (update the existing push flow)

Current state (read before changing): `IPushNotificationService`
(`src/WTF.Api/Services/PushNotificationService.cs`) has two methods, `SendOrderCreatedAsync` and
`SendOrderStatusChangedAsync`. Each one selects the recipients with its own copy of the same
query (active push tokens of active users, excluding the `AdminViewer` role and the acting
user), then sends through `IFcmPushClient` and `IHuaweiPushClient` (both skipped when not
configured). The data payload carries `orderId`, `orderNumber` and `path`: created orders point to
`/orders/editor/{id}`, status changes to `/orders/details/{id}`. On the client,
`app/core/services/push-notification.service.ts` routes by `orderId`/`path` (foreground web to the
order editor, native tap to order details, default the orders list) and creates the Android
channel `orders`.

Why it must change for this feature:

- A `PendingApproval` order cannot be opened in the POS editor, so the existing created-order
  path would open the wrong screen. Link orders need their own payload and routing.
- The system "Customer Link" user is the creator, so "exclude the actor" no longer filters
  anyone; recipients are all staff who can act on orders.
- Customer chat messages need a notification too (Phase 5).

Notification events:

| Event | Recipients | Title / body | Opens | Phase |
| --- | --- | --- | --- | --- |
| New link order | Active staff except AdminViewer | "New online order" / `Order #n - {customer} - Pickup|Delivery - PHP total` | Orders list (Awaiting approval banner), or order details | 3 |
| Customer message | Same | "Message from {first name}" / first 80 chars of the message | Order details with the chat open (`?chat=1`) | 5 |
| Order accepted / rejected | Optional: other staff, not the one who acted | "Order #n accepted" / "Order #n rejected" | Order details | 3 (optional, off by default to avoid noise; the banner already updates over SignalR) |

Work items:

- **Server:** extract the duplicated recipient query into one private method (for example
  `GetRecipientTokensAsync(excludeUserId)`) used by every send method; add
  `SendLinkOrderCreatedAsync(Order, decimal total, ...)` and
  `SendOrderMessageAsync(Order, string senderName, string preview, ...)`; add both to
  `IPushNotificationService`. Add a `type` field to the data payload (`online-order`,
  `order-message`; existing events keep working without it) next to `orderId`, `orderNumber`, `path`.
  Keep sends after commit and failure-tolerant, like the existing calls (a failed push never
  fails the order or the message). Link order create and chat call sites live in the Phase 3
  submit handler and the Phase 5 message handler.
- **Client:** in `push-notification.service.ts` route by `type`: `online-order` to the orders
  list (or order details), `order-message` to order details with the chat open; never to
  `OrderEditorById` for a `PendingApproval` order. Keep the existing default for payloads without
  a `type`. Both the web (Firebase) and native/Huawei tap handlers need the same routing.
- **Android channel (optional):** notification channels are immutable once created, so a
  distinct sound or importance for online orders needs a new channel id (for example
  `online-orders`) created alongside `orders`; the server then sends the channel id in the
  payload. Skip if the default channel is fine.
- **Customer side:** customers are anonymous, so no push for them. They get live updates over
  the Phase 5 customer hub and the My orders poll. Web push for customers (a per-link
  subscription) is a possible later addition.
- **Tests:** add `PushNotificationService` tests in `src/WTF.Tests/Services/` using NSubstitute
  fakes for `IFcmPushClient`/`IHuaweiPushClient` and the in-memory `WTFDbContext`: recipients
  exclude AdminViewer, inactive users and inactive tokens; nothing is sent when no client is
  configured; payload has the right `type`, `orderId` and `path`; one failing client does not
  stop the other. Frontend: `push-notification.service.spec.ts` cases for routing by `type`
  (online order, message, and a legacy payload without `type`).

### Phases

| Phase | Name                                         | Status    |
| ----- | -------------------------------------------- | --------- |
| 1     | Data model, staff endpoints, customer UI     | [Completed] |
| 2     | Public validation, ordering page, My orders  | [Completed] |
| 3     | Order submission, approval, staff alerts     | [Completed] |
| 4     | Reporting by source and per-link usage       | [Completed] |
| 5     | Order chat (per order, SignalR both sides)   | [Completed] |


Phase-by-phase build notes (what was built, checks, tests, later redesigns) are in
[customer-ordering-links-build-history.md](customer-ordering-links-build-history.md).
