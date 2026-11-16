-- STAGING ONLY. Run by the "Build and Deploy" workflow before the SQL scripts and the demo data, never against production.
--
-- Removes all shop and platform data so the demo data starts from nothing: every table is emptied except the fixed setup
-- below. The schema, SchemaScriptHistory and the setup rows are kept, so the SQL scripts that were already applied stay
-- applied. Order numbers and other identity counters start again from 1.
--
-- Kept as is:      SchemaScriptHistory, Statuses, PaymentMethods, Plans, ProductDefaults
-- Kept partly:     Tenants and TenantSettings (the default shop only), UserRoles (system roles only),
--                  RolePermissions (of the system roles only)
-- Everything else: emptied

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @defaultTenant uniqueidentifier = '00000000-0000-0000-0000-000000000001';
DECLARE @sql nvarchar(max);

BEGIN TRAN;

-- 1. Switch off foreign keys while the rows go, in any order
SELECT @sql = STRING_AGG(CAST(N'ALTER TABLE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' NOCHECK CONSTRAINT ALL;' AS nvarchar(max)), CHAR(10))
FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = 'dbo' AND t.is_ms_shipped = 0;
EXEC sp_executesql @sql;

-- 2. Tables that are partly kept
DELETE FROM dbo.RolePermissions WHERE RoleId IN (SELECT Id FROM dbo.UserRoles WHERE IsSystem = 0);
DELETE FROM dbo.UserRoles WHERE IsSystem = 0;
DELETE FROM dbo.TenantSettings WHERE TenantId <> @defaultTenant;
DELETE FROM dbo.Tenants WHERE Id <> @defaultTenant;

-- 3. Everything else
SET @sql = NULL;
SELECT @sql = STRING_AGG(CAST(N'DELETE FROM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N';' AS nvarchar(max)), CHAR(10))
FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = 'dbo' AND t.is_ms_shipped = 0
  AND t.name NOT IN ('SchemaScriptHistory', 'Statuses', 'PaymentMethods', 'Plans', 'ProductDefaults',
                     'Tenants', 'TenantSettings', 'UserRoles', 'RolePermissions');
EXEC sp_executesql @sql;

-- 4. Identity counters start again
SET @sql = NULL;
SELECT @sql = STRING_AGG(CAST(N'DBCC CHECKIDENT (N''' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N''', RESEED, 0) WITH NO_INFOMSGS;' AS nvarchar(max)), CHAR(10))
FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = 'dbo' AND t.is_ms_shipped = 0
  AND EXISTS (SELECT 1 FROM sys.identity_columns ic WHERE ic.object_id = t.object_id)
  AND t.name NOT IN ('SchemaScriptHistory', 'Statuses', 'PaymentMethods', 'Plans', 'ProductDefaults', 'Tenants', 'TenantSettings', 'UserRoles', 'RolePermissions');
IF @sql IS NOT NULL EXEC sp_executesql @sql;

-- 5. Foreign keys back on, and checked
SET @sql = NULL;
SELECT @sql = STRING_AGG(CAST(N'ALTER TABLE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' WITH CHECK CHECK CONSTRAINT ALL;' AS nvarchar(max)), CHAR(10))
FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = 'dbo' AND t.is_ms_shipped = 0;
EXEC sp_executesql @sql;

COMMIT;

PRINT 'Staging data removed.';
