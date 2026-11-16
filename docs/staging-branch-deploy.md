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
- After the SQL, every script in `tools/staging-seed` runs (see its README). Untick **apply_seed** to skip.

Keep a fresh main-state backup: take one right after each deploy from `main`.

Running two staging deploys at once is prevented: the second waits for the first.
