# Multi-tenant rollout checklist (production)

Written after the Phase 5 rehearsal on the local WTF database (a copy of production). Follow it top to bottom. Every step
that changes the database is undone by restoring the backup from step 1.

## Before you start

- [ ] Pick a quiet time. Tell the shop the POS will be offline for about 15 minutes.
- [ ] Have the shop's `appsettings` / environment access ready (the bootstrap and mode settings below).
- [ ] Decide on lease signing: unsigned leases work (leave the key empty). Signed leases need the key pair in step 8.

## 1. Back up and verify

- [ ] Take a full backup and verify it, then write down the file path:

```sql
BACKUP DATABASE [WTF] TO DISK = N'<path>\WTF_pre_multitenant_<date>.bak' WITH INIT, CHECKSUM;
RESTORE VERIFYONLY FROM DISK = N'<path>\WTF_pre_multitenant_<date>.bak' WITH CHECKSUM;
```

SQL Server Express cannot use `WITH COMPRESSION`. Copy the `.bak` off the server too.

- [ ] Rehearse the restore once on a copy (`RESTORE DATABASE [WTF_copy] ... WITH MOVE`) so you know it works.
- [ ] Save row counts for every table (the checks in step 4 compare against them):

```sql
SELECT t.name, SUM(p.rows) n FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
GROUP BY t.name ORDER BY t.name;
```

## 2. Stop the app

- [ ] Put the site offline (`app_offline.htm`) or stop the API, so nothing writes during the migration.

## 3. Run the scripts, in filename order

- [ ] Compare `SELECT ScriptName FROM SchemaScriptHistory` with `tools/sql`. A production copy can be many scripts
  behind (the rehearsal copy was 18 behind). Run every missing older script first, in filename order.
- [ ] Then the tenant scripts, in this order (the date-first filename order is correct):

1. `20261108_add_tenants.sql`
2. `20261109_add_dynamic_catalog_columns.sql`
3. `20261109_backfill_tenant_id.sql`
4. `20261110_enforce_tenant_id.sql`
5. `20261111_add_platform_admin.sql`
6. `20261112_add_subscriptions.sql`
7. `20261113_add_catalog_system_keys.sql`

- [ ] Each script is safe to run twice. Scripts do not record themselves: insert a row into `SchemaScriptHistory` after
  each one succeeds (`ScriptName`, `AppliedAt`), so the Audit page stays accurate.
- [ ] Stop at the first error. Do not continue past a failed script; restore the backup if unsure.

## 4. Check the data

- [ ] No table has a NULL or non-first-tenant `TenantId`: every row of every tenant table belongs to tenant #1
  (`00000000-0000-0000-0000-000000000001`, slug `wtf`), and the column is NOT NULL.
- [ ] Row counts match the step 1 snapshot for every table that existed before (Orders, OrderItems, Products,
  Customers, Users, AuditLog, and so on). New tables are expected to be empty, apart from the seed rows (tenant #1, its
  settings and subscription, plans, waste reasons, order number counter).
- [ ] `SELECT Id, Name, Slug, Status FROM Tenants` shows exactly one active tenant.

## 5. Deploy the code and the settings

- [ ] Deploy the API and the POS built from `main`. The data model was regenerated with `tools/dbsync.bat` and is
  already committed: do not run `dbsync.bat` against production.
- [ ] First start only: set `Platform__BootstrapUsername` and `Platform__BootstrapPassword` (password of at least 12
  characters). The first platform admin is created only while none exists. **Remove both settings after the first
  start.**
- [ ] Multi-tenancy is always on: there is no mode setting to switch. Make sure no old `Tenancy__Mode` setting is left on
  the server (it is ignored now).

## 6. First start checks

- [ ] Start the API. Every query is now limited to the signed-in shop, new rows get that shop.s id, and suspended or
  lapsed shops are blocked.
- [ ] Sign in as a real shop user and confirm products, orders, customers and stock look as before.
- [ ] Sign in to the platform area and check tenant #1 shows its real user and order counts.

## 7. Prove isolation (once, with a throwaway shop)

- [ ] On the platform page, create a test shop. Sign in as its owner: products, customers and orders must all be 0.
- [ ] Suspend it: sign-in and existing tokens are refused (403). Resume: access returns.
- [ ] Let its period lapse: reads still work, new writes are refused (402). Renew: writes work again.
- [ ] Cancel and delete the test shop. Tenant #1 must be unaffected throughout.

## 8. Optional: signed leases

- [ ] Generate a P-256 key pair:

```bash
openssl ecparam -name prime256v1 -genkey -noout -out lease.key
openssl pkcs8 -topk8 -nocrypt -in lease.key -out lease-private.pem
openssl ec -in lease.key -pubout -outform DER | openssl base64 -A
```

- [ ] Put the private PEM in `Subscription:LeaseSigningKeyPem` on the server (keep it out of git).
- [ ] Put the printed base64 public key in `leasePublicKey` in the environment files and rebuild the POS and the Android
  app. A POS built with a key refuses unsigned leases, so deploy the server key first.

## Rollback

| Where you are | What to do |
| --- | --- |
| Before step 3 | Nothing changed. Bring the site back online. |
| Steps 3 to 4 | Restore the backup (below). |
| Step 5 or 6 problem | There is no switch back to one-shop mode. Fix forward, or restore the backup (below) and redeploy the previous release. |
| After step 3 generally | The old API cannot run against the migrated schema: `TenantId` is NOT NULL, so its inserts fail. Rolling back to the old API means restoring the backup, and any orders taken since the backup are lost. |

Restore:

```sql
ALTER DATABASE [WTF] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE [WTF] FROM DISK = N'<path>\WTF_pre_multitenant_<date>.bak' WITH REPLACE, RECOVERY;
ALTER DATABASE [WTF] SET MULTI_USER;
```

## Rehearsal notes (Phase 5, local copy of production)

- The copy was 18 scripts behind; all applied cleanly. The tenant scripts backfilled every row to tenant #1 with zero NULLs.
- Row counts were identical before and after (1,772 orders, 7,310 order items, 116 products, 248 customers).
- Isolation, suspend and the subscription lock behaved as in step 7 with the always-on build.
- Before the mode switch was removed, a shop created while the API ran in Single mode got its users stamped as tenant #1; that
  trap no longer exists.
- `tools/dbsync.bat` output is kept as generated. The hand-written `WTFDbContext.Tenancy.cs` keeps only the tenant filter,
  stamping and order numbering.
