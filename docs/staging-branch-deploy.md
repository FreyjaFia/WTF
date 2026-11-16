# Deploying a branch to staging

Staging updates automatically when `main` changes. To test another branch online:

1. GitHub, Actions, **Build and Deploy**, **Run workflow**.
2. In "Use workflow from", pick the branch.
3. Tick **deploy_to_staging**. Leave **build_android** off unless you need the APK.
4. Run it.

## The database

Staging has one database. The SQL scripts in `tools/sql` only move it forward, and scripts from one branch stay
applied when you deploy another.

- Branch with no SQL, or SQL that only adds tables or columns: run it as is.
- Branch whose SQL renames, drops, adds a constraint or changes data: the run stops with an error. Restore the
  staging database from the main-state backup (MonsterASP panel), then run again with **db_restored** ticked.
- After the SQL, `src/WTF.StagingSeed` adds the demo data (all accounts use the GitHub secret `STAGING_SEED_PASSWORD`; without it nothing is created):
  - Accounts: platform admin `platformadmin`, owner `admin`, and `manager`, `cashier`, `viewer`, `stockmgr`, `itemmgr`.
  - Menu: categories, 9 products, add-ons (size, temperature, flavor, topping, extra), 3 promotions (one of each type).
  - Stock: 3 items (one fine, one low, one near critical), recipes, 2 suppliers, a receipt, 2 waste entries (one to review), 2 purchase orders and an open count.
  - Orders: completed (cash, GCash, tips, promo price), Senior and PWD discounts, held, cancelled, refunded, and a customer-link order waiting for approval.
  - Also customers (with addresses), expenses, and a second shop `Starter Demo Cafe` on the Starter plan (owner `starterowner`, open invoice).
  - It only adds what is missing and never changes or deletes existing rows or passwords. The one exception is the shop settings: Senior/PWD is switched on and empty receipt fields are filled.
  - Untick **apply_seed** to skip.

Keep a fresh main-state backup: take one right after each deploy from `main`.

Running two staging deploys at once is prevented: the second waits for the first.
