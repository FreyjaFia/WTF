# Staging seed scripts

SQL files in this folder run on the staging database after every staging deploy (after `tools/sql`), in file-name
order. They are never applied to production and are not recorded in `SchemaScriptHistory`.

Rules for a seed script:

- Safe to run again and again: insert a row only if it is missing, update it otherwise. Never delete.
- Only demo data (shop, users, menu, orders). No schema changes: those belong in `tools/sql`.
- No passwords or secrets.
- Name it for the branch or feature, e.g. `20261203_offline_phase_7.sql`, and remove it when the feature is merged and the data is no longer needed.
