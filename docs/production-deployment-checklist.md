# Production deployment checklist: Inventory, multi-tenant, RBAC and Temperature

Covers everything between production (release tag `v1.19.0`, scripts up to `20261020`) and `main` at `f367ed4`. Follow it top to
bottom. Every database step is undone by restoring the backup from step 1. **Nothing here is run by CI: the scripts, the
settings and the data checks are manual.** Do not point any of this at production from a test machine.

Multi-tenancy is always on (commit `8f5f6ca`). There is no `Tenancy__Mode` setting, no "ship dark" phase and no switch back to
one-shop mode. The only rollback is the backup restore.

## Decisions for Pogi before the date

Blocking (the release should not go without an answer):

- [ ] **Pilot shop and Platform admin.** Choose the platform admin username (and a password of 12 or more characters, kept out
  of chat and git) for step 5.
- [x] **Android app id.** Decided 10 Nov 2026: keep `com.wtf.pos` for now. Changing it later makes Android treat it as a different app and needs new Firebase and Huawei push setups plus renamed Java packages.
- [ ] **SchemaScriptHistory rows.** Add rows for `20261114` to `20261120` as for every other script? (Recommended: yes, step 3.)
- [ ] **Release tag.** Next tag (suggested `v1.20.0`; bump `src/wtf-pos/package.json` first, since CI reads the version from it).

Calls that do not block (the app works either way; say yes, no or later):

- [ ] **Data protection keys (low risk, non-blocking).** The API sets no key storage, so keys reset on every restart and the log shows a "keys not persisted" warning. Nothing in the API uses cookies, anti-forgery or `IDataProtector` (logins are JWT, signed with the `Jwt` key), so the warning can be ignored. Persist them only if something starts using them.
- [ ] **RBAC phase 4 plan decisions (four open):**
  1. Per-plan feature list. Default today: Starter = core features only, Pro = everything.
  2. Reports and Expenses on Starter. Today `reports.read` is core, so Starter keeps Reports, and Expenses are core too
     (the plan-gating draft says Pro).
  3. Custom roles Pro-only. The plan says yes, but it is not built (needs a new feature code). Today any plan can add custom roles.
  4. Notification recipient lists still ignore the plan.
  Decided: keep the defaults for this release and put the pilot shop on Pro (everything on). Full feature blocking by plan is not built (see `docs/roadmap/block-features-by-plan.md`) and is handled right after this release.
- [ ] **Inventory polish pass** (decided: do it before release) (`docs/roadmap/inventory.md`, "Polish pass before deploying inventory to production") is planned
  and not done. Pogi said yes. Items that bite on day one: the 640 to 1023 px layout squeeze, walking
  every screen as each role, the Android check (stock-in form, POS stock warning, pull to refresh, bell), and entering real
  opening counts before turning on "block sales below zero".
- [ ] **Stale-price notice.** It has a dismiss method but no banner calls it. Ship as is or fix first.
- [ ] **Stale `Tenancy:Mode` comment** in `20261108_add_tenants.sql` (line 8): decided to leave old scripts alone. No later script corrects it; it is only a comment.

## Before you start

- [ ] Pick a quiet time. Tell the shop the POS will be offline for about 30 minutes (28 scripts, a deploy, checks).
- [ ] Have server access ready: SQL Server (`.\SQLEXPRESS`), the host's settings, and the CI release page.
- [ ] Everyone signs in again after the deploy (the SuperAdmin to Owner rename invalidates old tokens). Tell the staff.
- [ ] CI is green on the commit you will tag (including the real SQL Server tests and the browser tests).

## 1. Back up and verify

- [ ] Full backup, verified, copied off the server:

```sql
BACKUP DATABASE [WTF] TO DISK = N'<path>\WTF_pre_release_<date>.bak' WITH INIT, CHECKSUM;
RESTORE VERIFYONLY FROM DISK = N'<path>\WTF_pre_release_<date>.bak' WITH CHECKSUM;
```

SQL Server Express cannot use `WITH COMPRESSION`.

- [ ] Rehearse the restore once on a copy (`RESTORE DATABASE [WTF_copy] ... WITH MOVE`).
- [ ] Save row counts for every table (step 4 compares against them):

```sql
SELECT t.name, SUM(p.rows) n FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
GROUP BY t.name ORDER BY t.name;
```

## 2. Stop the app

- [ ] Put the site offline (`app_offline.htm`) or stop the API, so nothing writes during the migration.

## 3. Pre-checks on production, then the scripts

Check before running anything (read-only):

- [ ] Only the six known roles exist, and nothing else:

```sql
SELECT Id, Name FROM UserRoles ORDER BY Id;
```

Expected: Admin 1, Cashier 2, AdminViewer 3, SuperAdmin 4, ItemManager 5, StockManager 6 (matched by name, not id). A seventh
role means stop and look: `20261119` sets `IsSystem` by name and adds per-shop unique indexes that an extra or duplicate
name would break.

- [ ] No user is stored with a role other than those six: `SELECT DISTINCT RoleId FROM Users`.
- [ ] Catalog parent categories: Coffee, Non-Coffee and Snacks may all derive to Food if their products sit there. After
  deploy, correct the **Non-Coffee** parent on the Catalog page (`docs/roadmap/dynamic-catalog.md`). Note it down now.
- [ ] Compare history with the folder, newest first: `SELECT ScriptName, AppliedAt FROM SchemaScriptHistory ORDER BY ScriptName`
  against `tools/sql`. Production was released at `v1.19.0`, which contained scripts up to `20261020_add_promotion_max_per_order.sql`.
  If any older script is missing from production, run it first, in filename order.

Run these 28 scripts, in this exact filename order (stop at the first error; each is safe to run twice):

| # | Script | Area |
| --- | --- | --- |
| 1 | `20261021_add_order_time_stock_deduction.sql` | Inventory |
| 2 | `20261022_add_stock_alerts.sql` | Inventory |
| 3 | `20261023_add_stock_alert_reminders.sql` | Inventory |
| 4 | `20261024_generalise_notifications.sql` | Inventory |
| 5 | `20261027_add_stock_waste.sql` | Inventory |
| 6 | `20261030_add_item_costing.sql` | Inventory |
| 7 | `20261031_add_recipe_allowance.sql` | Inventory |
| 8 | `20261101_add_recipe_size_and_replace.sql` | Inventory |
| 9 | `20261103_add_supplies_cost.sql` | Inventory |
| 10 | `20261104_add_product_size_amounts.sql` | Inventory |
| 11 | `20261105_allow_zero_size_amounts.sql` | Inventory |
| 12 | `20261106_drop_scales_with_size.sql` | Inventory |
| 13 | `20261107_add_stock_counts.sql` | Inventory |
| 14 | `20261108_add_expenses.sql` | Expenses |
| 15 | `20261108_add_tenants.sql` | Multi-tenant |
| 16 | `20261109_add_dynamic_catalog_columns.sql` | Multi-tenant |
| 17 | `20261109_backfill_tenant_id.sql` | Multi-tenant |
| 18 | `20261110_enforce_tenant_id.sql` | Multi-tenant |
| 19 | `20261111_add_platform_admin.sql` | Multi-tenant |
| 20 | `20261112_add_subscriptions.sql` | Multi-tenant |
| 21 | `20261113_add_catalog_system_keys.sql` | Multi-tenant |
| 22 | `20261114_add_suppliers.sql` | Inventory (phase 8) |
| 23 | `20261115_add_stock_receipts.sql` | Inventory (phase 8) |
| 24 | `20261116_add_item_par_level.sql` | Inventory (phase 8) |
| 25 | `20261117_add_purchase_orders.sql` | Inventory (phase 8) |
| 26 | `20261118_rename_super_admin_to_owner.sql` | RBAC (SuperAdmin becomes Owner, Id 4) |
| 27 | `20261119_add_role_management.sql` | RBAC (custom roles, RolePermissions, IsSystem) |
| 28 | `20261120_add_temperature_addon.sql` | Temperature (needs #21 first) |

Keep the date order even where it mixes areas: for example `20261110` makes `TenantId` NOT NULL, and `20261114` onward
creates tables that already include it.

- [ ] Scripts do not record themselves. After each success insert a row so the Audit page stays accurate (also for
  `20261114` to `20261120` if Pogi agrees above):

```sql
INSERT INTO SchemaScriptHistory (ScriptName)
SELECT N'<script file name>.sql'
WHERE NOT EXISTS (SELECT 1 FROM SchemaScriptHistory WHERE ScriptName = N'<script file name>.sql');
```

The table is `Id` (identity), `ScriptName` (with the .sql extension) and `AppliedAt` (defaults to UTC now), so leave `AppliedAt` out. The unique index is on `ScriptName`. The local database already has rows 49 to 55 for `20261114` to `20261120`.

- [ ] Stop at the first error. Do not continue past a failed script; restore the backup if unsure.

## 4. Check the data

- [ ] Every row of every tenant table belongs to tenant #1 (`00000000-0000-0000-0000-000000000001`, slug `wtf`), none NULL,
  and the column is NOT NULL.
- [ ] Row counts match the step 1 snapshot for every table that existed before (Orders, OrderItems, Products, Customers,
  Users, AuditLog, and so on). New tables are expected to be empty apart from seed rows (tenant #1, its settings and
  subscription, plans, waste reasons, the order number counter, the Temperature add-on type).
- [ ] `SELECT Id, Name FROM UserRoles` shows **Owner** (Id 4) and no SuperAdmin; the other five names are unchanged, all with
  `IsSystem = 1` and `TenantId NULL`.
- [ ] `SELECT Id, Name, Slug, Status FROM Tenants` shows exactly one active tenant.

## 5. Deploy the code and the settings

- [ ] Tag and push the release (`v*` tag): CI builds API, POS and APK, deploys, and creates the GitHub Release. Confirm the
  scripts above were already applied, because CI deploys the API but never runs SQL.
- [ ] **`tools/dbsync.bat` is NOT run on production.** The data model is already committed. If it is ever rescaffolded, keep
  its output as generated and only remove true duplicates if the build needs it (and say so).
- [ ] First start only: set `Platform__BootstrapUsername` and `Platform__BootstrapPassword`. The password is plain text, at
  least 12 characters (the app hashes it); the name is 50 characters at most. The first platform admin is created only while
  none exists, and the `PlatformAdmins` table must exist (script 19), or the log says "Platform bootstrap could not run".
  **Remove both settings right after the first start.**
- [ ] No old `Tenancy__Mode` setting left on the server (it is ignored now).
- [ ] Existing production settings still set: connection string, `Jwt` key, push credentials (FCM and Huawei), image and
  report storage. Stock reminders on with `DryRun` off at the intended time; `SubscriptionReminders` stays dry-run until you
  want its emails or notices.
- [ ] Optional signed leases: see step 8. Unsigned leases work (leave `Subscription:LeaseSigningKeyPem` empty).

## 6. First start checks

- [ ] The API starts and the log has no database error. `/api/ping` answers.
- [ ] Sign in as the real owner (everyone signs in again). Products, orders, customers and stock look as before.
- [ ] Sign in to the platform area and check tenant #1 shows its real user and order counts.
- [ ] The platform bootstrap settings are removed and the app still starts.

## 7. Smoke tests, per feature

Do these once, on the real shop, then with a throwaway shop where marked.

**Multi-tenant isolation (throwaway shop)**

- [ ] On the platform page create a test shop. Sign in as its owner: products, customers and orders are all 0, and tenant #1
  data is not visible.
- [ ] Suspend it: sign-in and existing tokens are refused (403). Resume: access returns.
- [ ] Let its period lapse: reads still work, new writes are refused (402). Renew: writes work again.
- [ ] Cancel and delete the test shop. Tenant #1 is unaffected throughout. Order numbers are per shop.

**RBAC and plans**

- [ ] The six built-in roles sign in and land where expected: Owner and Admin on the orders screen, a role with only Management
  keys on Management, Cashier on the register. `New Order` shows only with `orders.write`.
- [ ] Roles page: built-in roles are read-only; create a custom role, assign it to a test user, confirm the user sees only
  what the role grants, then delete both.
- [ ] Plan gating: on a Starter shop, a Pro-only screen shows "Not in your plan" (API 403, code `not_in_plan`); tenant #1 on Pro
  sees everything.
- [ ] Sign in as (read-only) shows only `.read` access.

**Inventory**

- [ ] Stock in an item, then sell a product linked to it: the stock drops at order time; refunding puts it back.
- [ ] Stock alerts: set a warning level, cross it, and the bell and Needs Attention show it (the reminder job is on with `DryRun` off).
- [ ] Waste, a stock count, a supplier, a receipt, a par level and a purchase order each save once and show in their lists.
- [ ] Phone, tablet and desktop widths for the Inventory hub and its Switch screen menu.
- [ ] Android: the app updates in place (or installs, if the app id changed), the POS stock warning appears, and the bell works.

**Temperature and catalog**

- [ ] The Temperature add-on type exists in Setup. Create Hot and Iced add-on products, link them on one product, mark one
  default: the register pre-selects it and the line reads "Latte, Iced, Large".
- [ ] Correct the **Non-Coffee** parent category on the Catalog page, then check the report and POS category tabs.

**Everything else**

- [ ] Take one real order (cash, then paid), check it appears in the list, the receipt and the day's report.
- [ ] The Audit page lists schema scripts, including the new ones if their rows were inserted.

## 8. Optional: signed leases

- [ ] Generate a P-256 key pair:

```bash
openssl ecparam -name prime256v1 -genkey -noout -out lease.key
openssl pkcs8 -topk8 -nocrypt -in lease.key -out lease-private.pem
openssl ec -in lease.key -pubout -outform DER | openssl base64 -A
```

- [ ] Put the private PEM in `Subscription:LeaseSigningKeyPem` on the server (keep it out of git).
- [ ] Put the printed base64 public key in `leasePublicKey` in the environment files and rebuild the POS and the Android app.
  A POS built with a key refuses unsigned leases, so deploy the server key first.

## Rollback

| Where you are | What to do |
| --- | --- |
| Before step 3 scripts | Nothing changed. Bring the site back online. |
| During or after the scripts | Restore the backup (below) and keep the previous release deployed. |
| Step 5 or later, a problem | There is no switch back to one-shop mode. Fix forward, or restore the backup and redeploy the previous release. |
| Any time after step 3 | The old API cannot run against the migrated schema (`TenantId` is NOT NULL, the SuperAdmin role is renamed). Rolling back means restoring the backup, and **any orders taken since the backup are lost**. |

```sql
ALTER DATABASE [WTF] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE [WTF] FROM DISK = N'<path>\WTF_pre_release_<date>.bak' WITH REPLACE, RECOVERY;
ALTER DATABASE [WTF] SET MULTI_USER;
```

## After the release

- [ ] Remove the platform bootstrap settings (if not done), confirm the backup file is stored off the server.
- [ ] Note the new tag in `docs/ROADMAP.md`, and update the status of Inventory, multi-tenant, RBAC and Temperature there.
- [ ] Open items for later: pilot shop onboarding, plan gating build, Offline Phase 7, Senior/PWD discount, the prod-to-UAT refresh.

## Rehearsal notes (multi-tenant, local copy of production)

- The rehearsal copy was 18 scripts behind; all applied cleanly and backfilled every row to tenant #1 with zero NULLs.
- Row counts were identical before and after (1,772 orders, 7,310 order items, 116 products, 248 customers).
- The RBAC and Temperature scripts (`20261114` to `20261120`) were applied to the real local database on 10 Nov 2026 (backup
  `C:\Users\Public\WTF_pre_rbac_temp_20261110.bak`); SuperAdmin was renamed Owner (Id 4). `SchemaScriptHistory` rows for them
  were not added.
- `WTFDbContext.Tenancy.cs` keeps only the tenant filter, stamping and order numbering; `dbsync.bat` output stays as generated.
