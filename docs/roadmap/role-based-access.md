## Role-Based Access Control (RBAC) [In progress: phases 1 to 4 built on branches rbac-phase-1 to rbac-phase-4]

Planning only (8 Nov 2026). Phase 4 (branch `rbac-phase-4`, stacked on phase 3, not merged): plan integration, the minimum plan-gating piece RBAC needs, built so the full plan-gating build can reuse it. `PlanFeatures` (`WTF.Calculations/Subscriptions`, pure) turns a plan's `Features` list into feature codes (`core` is in every plan; only `inventory`, `promotions`, `orderlinks`, `chat` and `workbook` can be switched; older words such as `pos,orders,reports,offline` are ignored) and `ITenantFeatures`/`TenantFeatureCache` (20 second cache, cleared at once by a plan edit or a plan change in platform admin) gives each shop its plan name and features; a shop with no subscription row keeps everything. Effective permissions are role permissions intersected with the plan: `PermissionClaimsMiddleware` puts only the in-plan keys on the request (and the unfiltered role keys, which the escalation guard uses, so a role carrying keys the plan switches off can still be edited), and the permission handler answers 403 `This feature is not in your plan.` (code `not_in_plan`) before it asks about roles. `GET /api/auth/permissions` now returns the intersection, and `GET /api/roles/permissions` marks each key `inPlan` with `availableInPlans`. Stored keys always stay on the role, so an upgrade brings them back. App: the signed-in list now comes from the server (stored with the session for offline, refreshed at start and on every new token; it also makes custom roles work in the app), the Roles editor greys out out-of-plan rows with a lock and `Not in your plan. Available in Pro.` (still counted in the summary, not toggleable, and not treated as permissions you lack), and the stock badge in the sidebar and dock starts only once the server list says stock is in the plan. Default mapping (OPEN, Pogi to confirm): Starter holds `core` only; Pro holds everything, as seeded. `reports.read` moved from the `workbook` feature to `core` so Starter shops keep Reports (only `reports.generate`, the monthly workbook, needs `workbook`); `expenses.*` stays in `core` (the plan-gating draft would make it Pro). Not done: custom roles as a Pro-only feature (the plan data has no key for it; it needs a new catalog feature code such as `customroles`, decision still open), notification recipient lists and cost redaction are unchanged, and the per-plan feature list is still the seeded one until the plan-gating build adds the catalog checklist in platform admin. Tests: unit and SQL-backed .NET tests for the rules, the handler, the cache and plan changes, Angular specs, and `tests/roles/roles-plan.spec.ts` (Starter versus Pro API behaviour, downgrade and upgrade keep role keys, locked rows on phone, tablet and desktop). Phase 3 (branch `rbac-phase-3`, stacked on phase 2, not merged): custom roles. Script `tools/sql/20261119_add_role_management.sql` adds `TenantId`, `IsSystem`, `Description` and `CreatedAt` to `UserRoles` (names widen to 50 characters and become unique per shop through two filtered indexes, and a custom name can never equal a built-in one), the `RolePermissions` table and the `UserRoleIdSeq` sequence (custom role ids start at 100); it is idempotent and was run twice against a real SQL Server in the tests. Built-in roles keep their bundles in code (nothing is seeded into `RolePermissions`, so a release changes them with the code and there is no drift to merge), custom roles keep theirs in the table; a role row with `TenantId` NULL is a built-in role visible to every shop, and an EF filter shows a shop its own custom roles plus the built-ins. `roles.manage` is a new permission held by Owner only. Permissions are now looked up from the user's current role on every request (`PermissionClaimsMiddleware`, `RolePermissionCache` with a 20 second lifetime that is cleared at once by any role or user edit), so a role edit or a move to another role takes effect on the next action with no re-login; a token naming a role that no longer exists (for example SuperAdmin) gets no permissions. API: `GET/POST /api/roles`, `GET/PUT/DELETE /api/roles/{id}`, `POST /api/roles/{id}/duplicate`, `GET /api/roles/permissions`. Guards: built-in roles cannot be changed or deleted; a role carries only keys that exist and what they require; nobody can create, edit, duplicate or assign a role holding a permission they lack themselves (403, Owner holds all); nobody changes their own role; a role with users cannot be deleted; the shop cannot lose its last active Owner; a custom role of one shop is invisible and unusable in another. Audit: `RoleCreated`, `RoleUpdated` (with the keys added and removed), `RoleDeleted` and `UserRoleChanged`. `UserDto.RoleId` is now a plain number and carries `RoleName`. App: Management > Roles (list with search, Filters drawer, sortable headers, Duplicate and Delete; editor with permission cards per area where ticking a permission ticks what it needs, a summary line, built-in roles shown read-only with Duplicate) and the role dropdown on the user form lists the roles the signed-in user may give, with descriptions. Still open for later phases: custom roles are not yet Pro-only (phase 4 left this open), the "New" badge in the editor, the offline permission cache and sign-in-as handling (phase 5), and notification recipient lists (stock alerts, waste review, billing reminders) still name built-in roles only, so a custom role does not receive them yet. Phase 2 (branch `rbac-phase-2`, stacked on phase 1, not merged): `suppliers.read` and `suppliers.write` split out of `stock.*` (Admin, Owner and Stock Manager write, Admin Viewer reads; the item-to-supplier links stay on `stock.*`), the Management menu, Setup page and Dashboard landing are derived from permissions (`ManagementMenuPermissions`, `SetupPermissions`, route `data.anyPermission`), and `AppRoleGroups` is deleted. A Stock Manager reaches Management only through Setup > Suppliers by construction. Behaviour is unchanged for every system role. Phase 1 built on branch `rbac-phase-1` (not merged): the SuperAdmin to Owner rename (script `tools/sql/20261118_rename_super_admin_to_owner.sql`; old tokens are refused), the permission catalog and system role bundles in code (`WTF.Api/Common/Auth/Permissions`, mirrored by `shared/permissions/permission-catalog.json`), API policies, cost redaction and recipient lists on permissions, `GET /api/auth/permissions`, and `can()`/route `data.permission` in the app, with golden tests. Not in phase 1: the `RolePermissions` table (bundles stay in code until custom roles in phase 3, so no dbsync is needed), `suppliers.*` and `roles.manage` (phases 2 and 3), the `UserEndpoints` Owner checks (phase 3 escalation guards), push notification recipients (no matching permission), and the offline permission cache (phase 5). Sections 1 to 7 below describe the plan and use the new name. Goal: decide **who in a shop can do what** with one clear model, instead of the hand-kept
role lists we have today. Plans (subscription) decide which features a shop has; RBAC decides which people in that shop
may use them.

### 1. How it works today

**Roles.** Six rows in `UserRoles` (`Owner`, `Admin`, `Cashier`, `AdminViewer`, `ItemManager`, `StockManager`),
one role per user (`Users.RoleId`). The table has no `TenantId`, so the roles are shared by every shop, and
`UQ_UserRoles_Name` makes the name unique. `PlatformAdmin` is not a database role: it is a separate login whose token
carries that role name, and it lives outside every shop.

**API.** `AppRoles` (names), `AppPolicies` (31 policy names) and `AppAuthorizationExtensions` (each policy is a
hard-coded `RequireRole(...)` list). Endpoints say `.RequireAuthorization(AppPolicies.X)`. The access token carries one
`role` claim, so a role change reaches a signed-in user only when their token is refreshed.

**Roles hard-coded outside the policies** (each one is a place that must be remembered when a role changes):
- `CostAccess.Roles` (who sees cost fields; many DTOs are redacted per caller).
- `UserEndpoints`: a non-Owner cannot create, edit, delete, restore or change pictures of a Owner, or give
  the Owner role.
- Notification recipients: `StockAlertService` (Owner, Admin, StockManager), `ItemAlertRecipientsHandlers`
  (adds AdminViewer), waste review (`RecordWasteHandler`, `WasteReviewNotifications`: Owner and Admin),
  `PushNotificationService` (everyone except AdminViewer).

**App (Angular).** `shared/constants/app-roles.ts` holds `AppRoleGroups`, a second hand-written copy of the rules,
used by `roleGuard` (`data: { roles: ... }` on routes), `AuthService.can...()` helpers and templates (37 uses). It is
deliberately not identical to the API (for example Cashiers may call the products and customers endpoints because the
order editor needs them, but have no Products or Customers screens), and a spec checks that a UI group never grants a
role the API denies. `ManagementMenu` and `SetupAccess` are UI-only lists added by hand (the Stock Manager case:
Management opens, but only Setup > Suppliers has anything in it).

**Current matrix** (from `AppAuthorizationExtensions`; S = Owner, A = Admin, V = AdminViewer, C = Cashier,
I = ItemManager, M = StockManager):

| Area | Read | Write |
| ---- | ---- | ----- |
| Orders, order chat | S A V C | S A C (override completed order: S A) |
| Order links | | S A C |
| Customers | S A V C (UI: no C) | S A C |
| Products (menu) | S A V C (UI: no C) | S A |
| Items (inventory items) | S A V I M | S A I |
| Inventory costs | S A V | S A |
| Stock (movements, counts, reorder, purchase orders, receiving, suppliers) | S A V M | S A M |
| Waste: record / review / reasons manage | record S A M C; reasons read S A V M C | review and reasons manage: S A |
| Expenses | S A V | S A |
| Promotions | S A V | S A |
| Dashboard, reports | S A V | generate reports: S A |
| Users | S A V | S A (Owner target: S only) |
| Shop brand, subscription and billing | | S A |
| Audit log, schema script history | S | |

### 2. Target model

**Permissions are hard-coded keys; roles are editable bundles of keys.**

- A **permission** is a key such as `orders.write`. The full list lives in code in one **permission catalog**: key,
  area, label, description, the plan feature it belongs to (`core`, `inventory`, `promotions`, `orderlinks`, `chat`,
  `workbook`), and the keys it needs (a write key needs its read key). Shops cannot invent permissions; only a release
  adds one.
- A **role** is a name plus a set of keys. A user has exactly one role (as today). No per-user overrides: "what can
  this person do" stays answerable by reading one role.
- API endpoints ask for a **permission** (`.RequireAuthorization("orders.write")` through a dynamic policy provider
  and one authorization handler), never for a role name. Anything that needs "any of" (the order editor loads
  products and customers) says so explicitly.
- The app asks for the same keys: `routes data: { permission: 'orders.write' }`, `auth.can('orders.write')`, template
  checks. `AppRoleGroups` and the role lists in `AppAuthorizationExtensions`, `CostAccess`, the recipient lists and the
  `UserEndpoints` checks all go away.
- **Menus are derived, not listed.** The Management menu shows when the user can open at least one Management screen;
  Setup shows when they can open at least one Setup tab; each tab checks its own key. This replaces the hand-kept
  `ManagementMenu` and `SetupAccess` lists, and the Stock Manager case works without special handling.
- **Notification recipients are derived** from permissions: stock alerts go to users holding `stock.read`/
  `stock.write` (as chosen per alert), waste review goes to holders of `stock.waste.review`, and so on.

**Draft permission catalog** (derived one-to-one from today's 31 policies, plus the splits marked new):

| Area | Keys |
| ---- | ---- |
| Orders | `orders.read`, `orders.write`, `orders.override`, `orderlinks.manage` |
| Customers | `customers.read`, `customers.write` |
| Menu | `products.read`, `products.write` |
| Inventory | `items.read`, `items.write`, `inventory.costs.read`, `inventory.costs.write`, `stock.read`, `stock.write`, `suppliers.read` (new), `suppliers.write` (new), `stock.waste.record`, `stock.waste.review`, `wastereasons.read`, `wastereasons.manage` |
| Money | `expenses.read`, `expenses.write` |
| Promotions | `promotions.read`, `promotions.write` |
| Insight | `dashboard.read`, `reports.read`, `reports.generate` |
| People | `users.read`, `users.write`, `roles.manage` (new) |
| Shop | `brand.manage`, `subscription.billing` |
| System | `audit.read`, `schemascripts.read` |

Notes on the splits: `suppliers.*` is carved out of `stock.*` so a shop can give someone Suppliers only (today they
share `StockMovements*`; the built-in Stock Manager gets both, so nothing changes for them). `roles.manage` is new.
A Cashier's need to load products and customers for the order editor is covered by those endpoints accepting
`orders.write` as an alternative, instead of giving every cashier `products.read` (which would open the Products
screen).

**Built-in (system) roles versus custom roles.**
- The six current roles become **system roles**: same names and ids, so `Users.RoleId` does not change. They are
  global (no tenant), **read-only templates** that we maintain in a release script. Each shop sees them in its role
  list with a lock and a "Duplicate" button.
- `Owner` is special: always every permission, cannot be edited or duplicated down, cannot be given by anyone
  but a Owner, and a shop can never be left with no active Owner.
- **Custom roles** belong to one shop (`TenantId` set), are created by duplicating or from scratch, and are fully
  editable. A new permission added in a release is **off** in every custom role and shown as "New" in the editor, so
  an update never widens anyone's access by itself. System roles get new permissions through the release script,
  decided case by case.
- Why not per-shop editable copies of all six: every release would have to merge new permissions into every shop's
  copy, and a shop that edited "Admin" would no longer match our support notes. Read-only templates plus custom roles
  give the same flexibility with one source of truth.

**Escalation guards (server side, always):**
- You can only assign or edit a role whose permissions are all ones you hold yourself (Owner excepted). This
  generalizes today's "only Owner touches Owner".
- You cannot change your own role, and you cannot grant `roles.manage` or `users.write` unless you hold them.
- A write key cannot exist without its read key; the server normalizes, the editor enforces it visibly.
- Deleting a role with users is refused until they are moved (the dialog offers a replacement role).

### 3. How it fits multi-tenancy and plans

- **PlatformAdmin stays outside RBAC.** Its separate login, token and `PlatformAdmin` policy are unchanged and hard-coded.
  The platform area never reads shop roles, and shop roles never grant anything in `/platform`. "Sign in as" gets the
  shop user's effective permissions; read-only sign-in strips every write key.
- **Tenant data.** `UserRoles` gains a nullable `TenantId` (null = system role), `IsSystem`, `Description`; the unique
  name index becomes per shop plus system names. EF global filter: roles with `TenantId` equal to the current shop
  **or null**. `RolePermissions(RoleId, PermissionKey)` is new; the keys are strings checked against the catalog (a
  key that no longer exists is ignored on load and cleaned by the next script). Tenancy Playwright tests must prove a
  custom role in shop A is invisible and unusable in shop B.
- **Plans and RBAC compose by intersection:** `effective = role permissions ∩ permissions whose feature is in the plan`.
  The plan decides what exists; the role decides who may use it. The catalog's feature code per key is the only link,
  so the plan-gating work (see "Plan: block features by subscription plan" in
  [multiple-branches-and-tenants](multiple-branches-and-tenants.md)) and RBAC share one `ITenantFeatures` service and
  one cache. The API answers 403 "not in your plan" before it asks about roles. In the role editor, permissions of
  features outside the plan are shown greyed with the plan name; they stay stored on the role, so an upgrade brings
  them back without editing roles.
- A lapsed shop's read-only behavior (402 on writes) is unchanged and sits above both.
- Possible plan rule (to decide): custom roles are a Pro feature, Starter shops use the six built-in roles.

### 4. Enforcement design

- **Where permissions come from.** Keep the single `role` claim, and resolve the user's current role and its
  permissions on the server through a small cache (user to role, role to keys, cleared on user or role edits, like
  `TenantStatusCache`). This makes a role edit or reassignment effective on the next request with no re-login, and
  keeps the token small (about 40 keys would otherwise bloat it and go stale). The login response and a new
  `GET /api/auth/permissions` give the app its effective list.
- **Offline.** The POS must keep working offline, so it stores the permission list with the session (the same place as
  the subscription lease) and refreshes it whenever it is online; offline it trusts the stored list, and the server
  re-checks on sync.
- **Cost redaction** (`CostAccess`) becomes a check of `inventory.costs.read`, so it follows the role editor.
- **Single source of truth, tested twice.** The catalog is mirrored in C# and TypeScript and covered by one shared
  sample file in `shared/` (like `calculation-cases.json`): keys, dependencies, feature codes, and the system-role
  bundles. Both test runs load it.

### 5. Migration of existing users

1. Script adds the columns and tables and seeds the six system roles' bundles. The bundles are generated **from
   today's policies**, so behavior does not change.
2. A **golden test** asserts, for every one of the 31 policies and the 6 roles, that the old role list and the new
   permission check give the same answer (UI groups included, with the known intended differences listed). It is
   removed after the old code is deleted.
3. Users keep `RoleId`. No user-visible change in phase 1.
4. The real database (and the backup, as a reference for what roles actually exist in production) should be checked
   for role names or ids beyond the six before the script runs: an unknown role would have no bundle and its users
   would lose everything, so the script must stop with a message instead of guessing. Not yet checked: this session
   could not reach the backup database.
5. Scripts are idempotent and never overwrite data; after them run `tools/dbsync.bat` and keep the scaffold output as
   generated (only delete true duplicates if the build needs it, and say so).

### 6. UI for managing roles

Management > Users gets a Roles tab (or Management > Roles; decide with the layout), in the app's current style
(shared components, POS classes, Filters drawer, sortable card rows, dialogs, mobile bottom bar):
- **List:** name, system or custom badge, number of users, short description; search and sort; New role, Duplicate.
- **Editor:** name and description, then permissions grouped by area as a read / write grid. Checking a write box
  checks its read box; unchecking read unchecks write. Plan-locked rows are greyed with the plan name. "New" badges
  after a release. A summary line ("Can open: Orders, Suppliers. Can change: ...") so an owner can read the result.
- **System roles:** open read-only with Duplicate.
- **User form:** the role dropdown lists system and the shop's custom roles with their descriptions, and only roles the
  signed-in user is allowed to assign.
- **Audit log:** role created, edited (with added and removed keys) and deleted, and user role changes.

### 7. Build phases

| Phase | What | Behavior change |
| ----- | ---- | --------------- |
| 1 | Catalog (C# and TS, shared sample file), `RolePermissions` table seeded from today's policies, permission policy provider and handler, permission cache, endpoints and `CostAccess` and recipient lists switched, app `can()` helpers and routes switched, golden test | None |
| 2 | Derived menus (Management, Setup), delete `AppRoleGroups` and the UI-only lists; `suppliers.*` split; Stock Manager sees only Setup > Suppliers by construction | Only the intended Stock Manager and Cashier cases |
| 3 | Role management: API (list, create, edit, delete, duplicate), escalation guards, audit entries, Roles screen and user form, tenant columns and filter | New feature |
| 4 | Plan integration: intersect with plan features through the shared `ITenantFeatures`; locked rows in the editor; optional "custom roles are Pro" | Follows the plan-gating build |
| 5 | Polish: offline permission cache, sign-in-as, Playwright on a throwaway database (custom role in A not in B, escalation refused, role edit effective without re-login, menus per role), docs | None |

Phase 1 is the large, risky one (every endpoint and 37 UI uses); the golden test is what makes it safe. Each phase
ships on its own.

### 8. Decisions (Pogi, 8 Nov 2026)

1. **Built-in roles:** the six stay as read-only system roles; shops add custom roles.
2. **Managing roles:** a grantable `roles.manage` permission, held by the owner role by default; nobody can grant a
   permission they do not hold.
3. **Custom roles are a Pro-only feature.** Starter shops use the built-in roles.
4. **No per-user exceptions:** one role per user.
5. **Role changes take effect on the user's next action** (server-side permission lookup, no re-login).
6. **Splits confirmed:** `suppliers.read/write` as their own pair; Cashiers load products and customers for the
   order editor through `orders.write`, without the Products or Customers screens.
7. **Order of work:** RBAC before plan gating (they share the catalog's feature codes and `ITenantFeatures`).
8. **SuperAdmin is renamed Owner everywhere** (stored name, code, tokens, UI, tests, docs), not just on screen.

**Owner role.** It stays a distinct role: always every permission, cannot be edited, cannot be locked out, a shop can
never be left without one, and only an Owner can create or edit another Owner (today's "only SuperAdmin touches
SuperAdmin" rule). What SuperAdmin alone could see today (audit log, schema script history) becomes ordinary
permissions (`audit.read`; `schemascripts.read` is a developer tool and should move to the platform side later) that
Admin or a custom role can be given. When branches arrive, Owner is the person who sees every branch and Admin or a
custom role can be limited to one.

**The rename (do it as part of phase 1, one commit of its own, before anything else).**
- Database: script renames `UserRoles` row Id 4 from `SuperAdmin` to `Owner` (idempotent: only when the name is still
  `SuperAdmin`); match roles by name, never by id (the real ids are Admin 1, Cashier 2, AdminViewer 3, SuperAdmin 4,
  ItemManager 5, StockManager 6). Then `tools/dbsync.bat`; keep the scaffold output as generated.
- API: `AppRoles.SuperAdmin`, `UserRoleEnum.SuperAdmin`, policy lists, `UserEndpoints` checks, recipient lists, the
  platform tenant-creation handler (first user), subscription reminders, seed data and tests.
- App: `AppRoles`, `AppRoleLabels` ("Owner"), role groups and specs, the tolerant role matching in `AuthService`
  (no alias for the old `SuperAdmin` claim: Pogi decided old tokens simply fail and everyone signs in again), and the
  e2e fixtures and Playwright tests.
- Docs and notes: `docs/`, the rollout checklist, and the throwaway database seeds.
- Existing tokens carry `role=SuperAdmin`; they are refused after the rename (decided 9 Nov 2026), so everyone signs in again.
- Real database state: 4 users (2 Admin, 1 Cashier, 1 SuperAdmin), no ItemManager or StockManager users locally.
