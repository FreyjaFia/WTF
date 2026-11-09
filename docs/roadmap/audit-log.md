## Audit Log Feature [Completed]

Track significant actions so management can review who performed an action and when.

### Implemented Database

- SQL script: `tools/sql/20260226_add_audit_log.sql`
- `dbo.AuditLog` table created with:
  - `Id`, `UserId`, `Action`, `EntityType`, `EntityId`
  - `OldValues`, `NewValues`, `IpAddress`, `Timestamp`
- Indexes added for common reads:
  - `IX_AuditLog_UserId`
  - `IX_AuditLog_Action`
  - `IX_AuditLog_EntityType`
  - `IX_AuditLog_Timestamp`
- Scaffolded into `WTFDbContext` and domain entities.

### Implemented Backend

- `IAuditService` + `AuditService` implemented and registered in DI.
- Uses enum-based action/entity values (`AuditAction`, `AuditEntityType`) to avoid magic strings.
- Audit logging currently integrated in key flows including:
  - auth login/logout handlers
  - order creation flow
- Read endpoints implemented:
  - `GET /api/audit-logs` (paged response)
  - `GET /api/schema-script-history`
- Authorization hardening implemented:
  - dedicated policies for audit resources (`AuditRead`, `SchemaScriptHistoryRead`)
  - only `Owner` can access audit logs and schema script history
  - existing admin capabilities retained for `Owner`

### Implemented Frontend

- Management routes and pages added:
  - `/management/audit-logs`
  - `/management/schema-scripts`
- Navigation entries and icons added under Management.
- Role-gated management navigation:
  - audit logs and schema scripts are visible to `Owner` only
  - route guards aligned with backend authorization rules
- Audit logs page:
  - fetches and displays audit log entries
  - refresh support + pull-to-refresh
  - responsive table/card styling aligned with management list pages
  - Filters drawer (same pattern as orders): date range (today / last 7 days / last 30 days / custom) and multi-select actions, remembered between visits
  - Download Excel / Download PDF of the filtered logs (`Accept` header negotiation on `GET /api/audit-logs`; `GET /api/audit-logs/actions` lists the action names)
- Schema scripts page:
  - displays executed SQL script history
  - refresh support + pull-to-refresh
  - responsive table/card styling aligned with management list pages

### Deployment Support

- Tag-based SQL deployment in CI (`.github/workflows/main.yml`).
- SQL scripts run in `tools/sql` order on tag builds.
- Role migration script added: `tools/sql/20260227_add_super_admin_role.sql` (the role is now called Owner, see `20261118_rename_super_admin_to_owner.sql`)
  - upserts `Owner` in `UserRoles`
  - upgrades username `admin` to `Owner`
- Re-run protection via `dbo.SchemaScriptHistory` check:
  - already applied scripts are skipped
  - newly applied scripts are inserted into history

---

