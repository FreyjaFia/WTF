## Multiple Branches, Branding and Selling to Other Stores [Planned, design decided]

Three related goals, planned together because they all need the same foundation: the app must know **which shop** and
**which branch** a request belongs to. Today it knows neither. There is one database, one set of users, one catalog, one
inventory, and the shop's name, logo, currency (PHP), time zone (`Asia/Manila`) and hosts are written in code and in
`appsettings.json`.

| Phase | Name                                   | Status    |
| ----- | -------------------------------------- | --------- |
| 1     | Branches inside one shop               | [Planned] |
| 2     | Branding settings (white label)        | [Planned] |
| 3     | Selling to other stores (multi-tenant) | [Planned] |

### Terms

- **Tenant** (a shop, the customer who buys the app): owns its own users, catalog, customers, promotions and settings.
- **Branch** (a location of one tenant): owns its own stock, orders, cash and staff assignments.
- **White label**: the buyer's own name, logo, colors and address on the app, receipts, customer link page and emails,
  with no "WTF" showing. ("White labeling" is the right term.)

### Decision: one shared app and database, tenants separated by a `TenantId` (not one isolated install per store)

Options compared:

| | Shared app + one database, `TenantId` on every row (chosen) | Database per tenant | Fully isolated install per store |
| --- | --- | --- | --- |
| Cost per store | lowest | low to medium | highest (a server, a database, a deploy each) |
| Releasing a fix | once, everyone gets it | once, plus a migration run per database | once per store; stores drift onto old versions |
| Data separation | by code (a missed filter leaks data) | strong | strongest |
| Onboarding a new store | a row and an invite | script that creates a database | a full deployment |
| Fits this codebase | needs `TenantId` everywhere (large but mechanical) | needs a connection per request | nothing to change, but does not scale |

Why shared: the hosting is MonsterASP shared hosting with `tools/sql` scripts run by CI on tag builds; running a copy per
store would multiply every release and every SQL script by the number of stores. Isolated installs are only worth it for
one large buyer who demands it (see "Escape hatch").

**Safety net for the shared model (required, not optional):** a global EF Core query filter on `TenantId` for every
tenant-owned entity, and `TenantId` set in one place on save (`SaveChanges` override), so a handler cannot forget it. A
test fails if an entity that has `TenantId` is missing the filter, and a database test proves tenant A never reads tenant B
in each area (orders, customers, items, reports, images, chat, audit log). Cross-tenant leaks are the one risk that would
end the business, so this test is the gate for Phase 3.

### Decision: subdomains for addressing, custom domains later

- Each store gets `{slug}.<our domain>` (for example `moonbrew.wtfpos.app`). The API reads the host, resolves the
  tenant, and puts it on the request. One certificate (wildcard) covers all of them. Needs a domain we own and a wildcard
  DNS record; MonsterASP shared hosting may not offer wildcard bindings, so check the plan before promising this
  (fallback: a path or header such as `/t/{slug}`, or a hosting move).
- The customer ordering link keeps the same tail (`/shop/:token`) under the store's subdomain. The token already names the
  customer, so the tenant also comes from the link, never from anything the visitor types.
- Custom domain per store (`order.theircafe.com`) is a paid extra for later: a `TenantDomains` table (host to tenant) and
  automatic certificates. Do not build it first.
- The Android app is a single app with a "shop code" (or the subdomain) entered at first login, stored on the device. One
  APK for everyone. A store-branded APK (own name and icon on the Play Store) is a separate paid tier, because it needs its
  own build and store listing (see Phase 2).

### Phase 1 - Branches inside one shop [Planned]

Goal: one owner, several locations, with their own stock, orders and staff, and reports that can show one branch or all.

**Data model** (`tools/sql/<date>_add_branches.sql`, idempotent, then `tools/dbsync.bat`)

- `Branches`: `Id`, `Name`, `Code` (short, used in order labels), `Address`, `Phone`, `TimeZone`, `IsActive`, audit columns.
  Soft delete like the rest of the app. The existing data becomes the first branch ("Main"), created by the script.
- `UserBranches` (user to branch, many to many) plus `Users.DefaultBranchId`. SuperAdmin and Admin see every branch; a
  Cashier works in the branches they are assigned to.
- `BranchId` (required, backfilled to Main) on: `Orders`, `StockMovements`, `OrderLinks` (a link orders from one branch),
  `AuditLog` (optional filter), and the cash/shift records when they exist.
- **Shared across branches** (one catalog, edited once): products, categories, add-ons, promotions, customers, loyalty,
  images. **Per branch:** orders, inventory quantities, stock movements, order numbers, staff assignments, receipt header.
- Optional later: per-branch price override or "not sold here" flag on a product (`ProductBranches`). Not in the first
  cut; ask before building, because it changes how every price and the offline catalog are worked out.

**Inventory.** `Items` stay shared as a definition (name, unit, SKU), but `CurrentQuantity` moves to `ItemBranchStock`
(`ItemId`, `BranchId`, `CurrentQuantity`, warning and critical levels, `AllowNegativeStock`). Stock movements carry the
branch. Add a **stock transfer** (movement pair `TransferOut` and `TransferIn` with one reference id, in one transaction).
This must land before or together with the order-time deduction plan, so deduction is written branch-aware once and not
reworked: `IOrderStockService` takes the order's `BranchId`.

**Request context.** A `ICurrentBranch` service (like `HttpContext.User.GetUserId()`): the POS sends the active branch in
a header (`X-Branch-Id`) chosen at login and switchable from the header menu; the API checks the user is assigned to it.
Handlers use `ICurrentBranch`, never a branch id from the body for writes. The public customer link takes its branch from
the link.

**Order numbers.** `OrderNumberSeq` is one global sequence. Keep it global (unique, simple); show a branch prefix on
screens and receipts (`MNL-1042`) from `Branch.Code`. Offline order numbers (`OFF-YYMMDD-###`) gain the branch code, and
`OfflineLocalId` stays unique per device.

**Calculations (`WTF.Calculations`).** No arithmetic changes, but the report layer needs a branch filter and a branch
breakdown. New math (for example sales per branch, share of total, transfers in and out) goes into `ReportRules` and
`StockRules`, with the shared cases kept in step on the Angular side. `ReportPeriods` already takes a time zone; make it
use the **branch's** time zone, so the "shop day" is right for a branch in another zone.

**Reports and dashboard.** A branch picker (All branches / one branch) on the dashboard and every report, remembered like
the other filters, and a "by branch" report (sales, orders, average, voids, low stock per branch). The Daily Close (Z-report)
is per branch. The monthly workbook gets a branch option, like the source option (its own file per branch).

**Authorization.** New policy `BranchesManage` (SuperAdmin, Admin). Every order, stock and report handler checks the
caller may use the requested branch. Add to `RouteTableTests` and `PolicyMatrixTests`.

**Offline.** The device stores its branch in the cart and queue records; a queued order syncs to the branch it was sold in,
even if the user switched branch afterwards. The sync review (Offline Phase 6) is unchanged. Catalog cache is shared; the
stock cache (when POS stock warnings arrive) is per branch.

**Customer link.** Pickup happens at a branch: the link (or the order) names the branch, delivery too. A customer who can
order from several branches picks one at checkout (list of active branches). Staff alerts and the "Awaiting approval"
banner go to staff of that branch only.

**Tests.** A branch cannot be read or written by a user who is not assigned to it; backfill puts all old rows in Main;
transfers move stock in one transaction and refuse a negative result when blocking is on; reports for one branch plus the
others add up to "All"; order numbers stay unique; the offline sync saves into the branch it was queued in.

### Phase 2 - Branding settings (white label) [Planned]

Goal: the buyer sees their own name and look everywhere, with nothing hardcoded.

**What becomes a setting** (`TenantSettings`, one row per tenant; `BranchSettings` for the per-branch parts):

- Identity: shop name, short name, tagline, logo (light and dark), favicon, receipt logo, address, phone, email.
- Colors: a primary and an accent color (and the DaisyUI theme name to start from). The app already has a default and a
  cafe style; the new theme is generated from the two colors, so contrast is checked automatically (reject a pair that
  fails accessible contrast).
- Locale: currency code and symbol, decimal places, time zone, date format, week start. Today `Asia/Manila`, PHP and the
  peso sign are scattered through code (about 290 occurrences in 80 files, mostly tests); they move behind one
  `ShopLocale` (API) and one `locale` provider (Angular) so a new shop can use another currency. `money.ts` and
  `Money` already work in whole minor units; only the symbol and the number of decimals become settings.
- Receipt text: header lines, footer message, optional tax/registration number line (display only; the app does not compute
  tax, see the reports section).
- Customer link page: header name, logo, welcome line, contact info, order rules text.
- Push and email wording that now says "WTF".

**How it reaches the app.** A public, cached, no-auth `GET /api/public/brand` (resolved from the host) returns the name,
logo URLs, colors and locale. The Angular app loads it before first paint, sets CSS variables for the theme, the page title
and favicon, and exposes it through a `BrandService`. The customer link page loads it the same way, so a customer never
sees another store's brand. Fallback: the default WTF brand when nothing is set (and for the development host).

**Where "WTF" is allowed to stay.** A small "Powered by WTF POS" line on the customer link page and the login screen for the
standard plan; removable on a higher plan (a feature flag on the tenant). Decide this pricing question before building.

**The Android app.**

- Standard: one shared app; after the shop code is entered, it takes the name, logo and colors from the brand endpoint.
  The launcher icon and the app name in the Android list stay "WTF POS", because those are fixed at build time.
- Premium (optional): a branded build per store (own name, icon, splash, package id, and its own Play Store listing). Needs a
  build pipeline that takes a tenant brand file and produces a signed APK or AAB. It is real ongoing work (store
  accounts, review, updates per store), so price it as a separate service, not a toggle. The auto-update check
  (`UpdateService`, GitHub Releases) is tied to our repository and would need a per-store release source.

**Images.** Brand images use the existing image storage, in a folder per tenant (`images/{tenantId}/...`). Stale Image
Cleanup must treat the tenant brand rows as in use (add them to `ImageReferences.ReferencingEntities`; its test fails
otherwise).

**Tests.** Brand falls back to defaults; a color pair with poor contrast is refused; the brand endpoint is anonymous but
returns nothing private; currency and decimals change the totals shown and the export headers; receipts and the customer
page render the brand; no "WTF" string remains in templates except through the brand (a test greps the templates).

### Phase 3 - Selling to other stores (multi-tenant) [Planned]

**Build status (7 Nov 2026, branch `multi-tenant-phase-1`; the build phases of the separate multi-tenant plan, not the phases of this section):** build phase 1 (Tenants table, `TenantId` columns, filters, stamping) and build phase 2 (enforcement) are done. Phase 2: `tools/sql/20261110_enforce_tenant_id.sql` makes `TenantId` required with foreign keys, per-tenant unique indexes and a per-tenant order counter (`TenantCounters`); `tenant_id` claim in the JWT (old tokens count as the first tenant for one release); hub groups, push, images, reports and chat pictures are prefixed by tenant; raw SQL is tenant-guarded; daily jobs loop over active tenants; the promotion limit gate is one lock per tenant; the POS tags queued offline orders with their shop and clears caches when the shop changes. Scripts to run on the real database, in order: `20261108_add_tenants`, `20261109_backfill_tenant_id`, `20261110_enforce_tenant_id`, `20261111_add_platform_admin`, then `tools/dbsync.bat`. The first three were run twice on a throwaway SQL Server 2025 built from the pre-tenant model (empty tables, so the backfill itself is not tried on real rows) and the 120 real-SQL tests pass (8 Nov 2026).

**Build phase 3, platform admin (8 Nov 2026, same branch).** `PlatformAdmin` is a role outside every shop with its own login (`POST /api/platform/auth/login`, username and password, five wrong tries lock it for 15 minutes, rate limited, every sign-in audited in `PlatformAuditLog`) and its own token with no `tenant_id`; the legacy-token fallback never treats it as the first shop and the `PlatformAdmin` policy admits no shop role. First admin: set `Platform:BootstrapUsername` and `Platform:BootstrapPassword` (12+ characters) once; it is created only while there is none, then take the password out of the settings. `/api/platform/*`: list, create (owner SuperAdmin with a one-time password and must-change flag, inactive system user `customer-link.<slug>`), suspend, resume, cancel, people list, reset password (one-time password, sessions ended, never logged), sign in as a person (30 minutes, read-only unless allowed, reason required, `impersonated_by` claim; writes go to the platform log, accounts and passwords stay untouchable), export (zip of one JSON per table, no passwords or tokens, no images), deletion preview and delete permanently (suspended or cancelled only, typed address plus the admin password, rows deleted in dependency order in one transaction, images and chat pictures removed afterwards, a tombstone keeps the address taken, the first shop is refused). A suspended or cancelled shop is refused at login, refresh and on every request (`TenantRequestGuardMiddleware`, status cached 20 seconds). Usernames are now checked for uniqueness across all shops. Screens: `/platform/login` and `/platform` (shops, people, export, log, dialogs) and an amber bar in the shop app while signed in as someone. Script `20261111_add_platform_admin.sql` adds `PlatformAdmins`, `PlatformAuditLog`, `TenantTombstones` and `Users.MustChangePassword`. **Not built yet:** copying a template shop (categories, add-on types and other lookups keep fixed ids and are shared, so a new shop starts empty apart from its two users), forcing the change-password screen in the POS when `mustChangePassword` is returned (the flag is saved and sent at login), reports files under the shop folder in delete, and a browser check of the platform screens. New tables are configured in `WTFDbContext.Tenancy.cs`, so after `tools/dbsync.bat` remove any duplicate the scaffold adds.

**Build phase 4, subscriptions, lock and branding (8 Nov 2026, same branch).** Script `20261112_add_subscriptions.sql` adds `Plans` (starter 1500, pro 2500 per month), `TenantSubscriptions`, `TenantInvoices` and `TenantSettings` (brand, one row per shop); the first shop gets a Pro subscription with 60 free days. Rules are `SubscriptionRules` (WTF.Calculations) and `shared/calculations/subscription-rules.ts`, with the shared cases `subscriptionWarnings`, `subscriptionClock` and `subscriptionLeaseAge`: access runs until the period end plus the grace days, warnings at 7 days, 3 days and after the end, a lock after the grace. **A lapsed shop** can still sign in and read, but every write gets a 402 (`TenantRequestGuardMiddleware`), and its public customer links answer as not found; a shop with no subscription row, or a single-shop install, is never locked. **Android lock:** `GET /api/subscription` returns a lease signed with ECDSA P-256 (`Subscription:LeaseSigningKeyPem`); the app checks it with `environment.leasePublicKey` (empty skips the check in development), keeps the latest server time it has seen so a clock set back does not buy days, shows a banner (renew details for SuperAdmin and Admin, 'ask the owner' for others) and a lock screen with Check again and Log out (unsynced offline orders are kept). It asks for a connection when the lease is older than `maxAgeDays`. **Manual billing:** platform admin sets plan, period end, grace days and discount, creates invoices (a full year costs 10 months) and marks them paid, which extends the period and turns a trial active; reminders go to SuperAdmin and Admin 7, 3 and 1 days before the end and daily during grace (`SubscriptionReminderScheduler`, kind `Subscription`). **Branding:** `GET/PUT /api/settings/brand`, `GET /api/public/order-links/{token}/brand`, a Shop page and a Subscription page under Management; the shop name replaces 'WTF' in the header, sidebar and customer page, the logo is uploaded on the Shop page (`POST/DELETE /api/settings/brand/logo`, the same image checks as other pictures, stored under `images/brand`; add that folder to the stale image cleanup scope before widening it) and the brand body no longer carries a time zone or currency (the shop keeps Asia/Manila and PHP; the unused columns stay in `TenantSettings`), and the colour is checked for contrast (`ColorRules`). **Not built:** plan feature flags are stored and sent but not enforced, no hard `MaxUsers` limit, a once-per-login warning dialog, a distinct 'temporarily unavailable' page on the customer link, and the lease key pair must be made once (`openssl ecparam`, PKCS8 PEM in settings, SPKI base64 in the environment files). Scripts to run on the real database, in order: `20261108` to `20261112`, then `tools/dbsync.bat`.

**Main merged in, catalog and expenses made tenant-aware (8 Nov 2026, same branch).** `origin/main` (dynamic catalog, Setup hub, Expenses, repo-size commits) was merged into the branch (a merge, not a rebase: eight branch commits would have repeated the same conflicts). `Expenses` is now tenant-owned: it is in the lists of `20261108_add_tenants`, `20261109_backfill_tenant_id` and `20261110_enforce_tenant_id` (none of them has run on the real database yet, so they were edited in place), has the filter and stamping, and is exported and deleted with its shop. Categories, sub-categories, add-on types and waste reasons were already tenant-owned. Their ids are chosen by the app and are primary keys across all shops, so the Save handlers now take the next id over all shops (`IgnoreQueryFilters`). The Size and Extra add-on types were found by the fixed ids 1 and 4; they are now marked by `AddOnType.SystemKey` (`size`, `extra`, unique per shop, script `20261113_add_catalog_system_keys.sql`). **Template copy:** creating a shop copies the first shop's active categories, sub-categories, add-on types and waste reasons with new ids (`TenantCatalogTemplate`), so a new shop starts with a working catalog and its two users. Products, add-ons and stock are not copied. Scripts to run on the real database, in order: `20261108` to `20261113`, then `tools/dbsync.bat` (remove any duplicate class it scaffolds for the platform tables). All six were run twice on a throwaway SQL Server built from main's schema with seed data. **Known gap:** stale image cleanup only covers the `users` folder, not `images/brand`.

Goal: a second, third and tenth shop can sign up (or be set up by us) and run on the same deployment, without seeing each
other.

**Data model**

- `Tenants` (`Id`, `Name`, `Slug` (unique, lowercase, reserved words blocked), `Status` (Trial, Active, Suspended,
  Cancelled), `Plan`, `TrialEndsAt`, created and updated columns) and `TenantDomains` (host to tenant, for custom domains
  later).
- `TenantId` on every tenant-owned table (users, roles assignments if stored per tenant, branches, products, categories,
  subcategories, add-on types, product add-ons and overrides, promotions and all rule tables, customers, loyalty, items,
  stock movements, orders and children, order links, conversations and messages, images, audit log, report and workbook
  files). Written as a script that adds the column, backfills the current data to a first tenant (the WTF shop itself), then
  makes it required and adds the global query filter. Child tables that always travel with a parent can inherit the parent's
  tenant, but keep `TenantId` on anything queried on its own (orders, items, customers, audit log, images, messages).
- **Unique rules become per tenant:** product names, SKU, barcode, usernames or emails, customer numbers, link tokens stay
  globally unique (they are secrets), promotion names. Every unique index that is not a secret gets `TenantId` in it.
- **Users:** a user belongs to one tenant (simplest). Login takes the tenant from the host (or shop code on Android). The same
  email can exist in two shops. A user who works for two shops is two accounts for now.
- **Roles:** the existing roles (SuperAdmin, Admin, Cashier, AdminViewer) become per tenant. A new platform role,
  `PlatformAdmin` (us), lives outside any tenant and can create and suspend tenants and look into one for support, with
  every such access audited. Never reuse the tenant `SuperAdmin` for that.

**Request pipeline.** Tenant resolution middleware (host to tenant; unknown host is a 404 that reveals nothing; a suspended
tenant gets a clear "account suspended" page and its API calls are refused except for the owner billing page). The tenant id
is also put in the JWT and checked against the host on every request (a token from shop A is refused on shop B's host).
An `ICurrentTenant` service feeds the query filter, the audit service, storage paths and the rate limiter.

**Per-tenant everything that is global today** (each is an item to review, and a test):

- Background jobs: the monthly workbook scheduler, stale image cleanup and chat message expiry loop over tenants and run
  each in the tenant's own time zone and settings, and one tenant's failure never stops the others.
- Storage: the blob container, report folder and chat image container are shared, with a `{tenantId}/` prefix; the cleanup
  jobs only look at the tenant they are running for.
- Rate limits and `PromotionLimitGate`: partitioned by tenant so one busy shop cannot slow another; the gate key includes
  the tenant (it is one lock per process today).
- SignalR: groups are prefixed by tenant (`DashboardViewers`, staff and customer order hubs), and the hub checks the tenant
  on connect.
- Push notifications: recipients are chosen within the tenant only; FCM and Huawei credentials stay ours (one app), with the
  shop name in the title from the brand.
- Order number sequence: one global sequence still works (unique); decide whether a shop may see its own count starting at 1
  (a `TenantOrderCounter` table with a lock) because a new shop seeing order 48,213 on day one looks odd. Recommended: a
  per-tenant counter.
- Audit log, schema script history and SuperAdmin-only pages: the tenant SuperAdmin sees only their own audit log; the
  schema script history and system pages move to `PlatformAdmin`.
- Customer link tokens and the loyalty redirect: tokens remain global secrets, but the lookup also sets the tenant.
- CORS: the "AllowUI" policy accepts `*.<our domain>` and registered custom domains, not a fixed list.

**Onboarding and billing**

- A `PlatformAdmin` page (a separate small area of the app, or a separate admin site) to create a tenant, pick the slug and
  plan, create the first SuperAdmin, load starter data (a few categories, one branch, sample products, optional), suspend
  and export. Self-service sign-up is a later step; start with us creating each store by hand while there are few.
- Plans and limits (decide the pricing first): number of branches, number of users, optional features (branding removal,
  chat images, customer links, inventory, branded Android app) as flags on the tenant, checked server side by one
  `ITenantFeatures` service and mirrored in the UI.
- Payment: start with manual invoicing; add a payment provider only when there are enough stores to justify it (subscription
  billing handles card data, so it must go through the provider's hosted checkout, never our own forms).
- Data export on request (their orders, customers, products as files) and a deletion procedure when a store leaves.
  Also required for privacy law (the Philippines Data Privacy Act, and similar elsewhere): a data processing agreement,
  a privacy notice for the customer link page, and clear retention (chat expiry already exists).

**Escape hatch: a fully isolated install.** If one buyer insists (own server, own database, their own legal control), deploy
the same code as a single-tenant instance: one tenant row, their own host and database, same release. This works because the
app always runs with a current tenant, even when there is only one. Keep this possible; do not build a separate fork.

**Security and risks**

- The `TenantId` filter is the whole separation; guard it as described above (filter on every entity, tests per area, no
  `IgnoreQueryFilters` outside platform code, and a review rule for raw SQL, which bypasses filters).
- Never trust a tenant id from the body, query string or headers for writes; it comes only from the host and the token.
- Reports and exports (Excel, PDF, CSV, the workbook) must be built from tenant-filtered queries and saved under the tenant's
  folder; a test downloads one tenant's file with another tenant's login and expects a 404.
- Back up and restore per tenant is harder in a shared database: plan the export tool before the first paying store.
- Support access (`PlatformAdmin` reading a tenant's data) is audited and visible to the tenant.

**Pricing and plans (to decide before onboarding a paid store)**

- **Charge per branch per month, not per user.** Cafes share logins and hire part-timers; per-user pricing pushes owners to
  share one cashier account, which defeats the audit log, voids and per-staff reports. Our costs grow with orders, storage
  (images, chat photos) and support, not with user count. Include a generous user count (for example 10, or unlimited) in
  every plan. A branch is also what an owner can see and predict.
- **Plan shape (sketch, numbers to be set after market research):**

  | Plan | For | Includes |
  | --- | --- | --- |
  | Starter | one branch | POS, orders, basic reports, offline mode |
  | Pro | one or more branches | adds inventory, promotions, customer ordering links and chat, all reports and the monthly workbook |
  | Business | chains | adds multi-branch reports, stock transfers, removal of "Powered by", priority support |

  Price per branch per month, with a discount for paying yearly. Separate add-ons: branded Android app (setup fee plus
  yearly fee), custom domain, data migration or setup help, and cashless payment fees (see Cashless Payments).
- **Implementation.** Plans are feature flags on the tenant, checked by one `ITenantFeatures` service and mirrored in the
  UI. Gate only the few features the plans actually differ on; do not scatter checks. Branch count is a hard limit checked
  when a branch is created.
- **To research before setting numbers:** current Philippine POS competitors and any free tiers (a free tier sets the ceiling
  for small shops), our real cost per store (hosting, storage, push, support time), and payment-provider fees.
- **Pilot first.** The first outside store runs at a discount in exchange for feedback; set the price list after that.
- **Collecting money.** Start with manual invoicing (bank or e-wallet transfer). Add subscription billing only when there are
  enough stores, and only through the provider's hosted checkout (never our own card forms).
- **Open decisions:** is "Powered by" removal a paid feature, is a free trial offered (length), what happens to a suspended
  store's data and for how long (read-only period, then export, then deletion).

**Order of work (do not skip ahead)**

1. Decide the commercial questions: who the first buyers are, price and plans, whether branding removal is paid, whether a
   branded Android app is offered, and which domain the subdomains live under (check that the host allows wildcards).
2. Phase 1 (branches) first. It is useful to the current shop on its own and teaches the codebase to carry a "where" on every
   row; the `TenantId` work is the same pattern one level up, so it is cheaper afterward.
3. Phase 2 (branding settings and locale) next: it is mostly settings and removing hardcoded strings, and it needs no tenant
   separation, so it can ship before any second store exists.
4. Phase 3 in this order: tenants table and middleware, `TenantId` and filters with the leak tests, per-tenant jobs and
   storage, then the platform admin page, then onboarding the first outside store as a pilot at a discount.
5. Only after a pilot has run a few weeks: custom domains, branded Android builds, self-service sign-up, payments.

**Open questions for the owner**

- Is a branch allowed to have its own prices or its own menu, or is the catalog always the same everywhere?
- Do branches share one cash drawer concept, or does each branch close its own day (assumed: each branch closes its own day)?
- Should customers be shared across branches (assumed yes, with loyalty points usable at any branch)?
- Should one login be able to work for two different shops (assumed no)?
- Is the app sold as a subscription run by us (assumed), or as a one-time install for the buyer to host (this changes the
  isolated-install option from escape hatch to the main product)?

---

