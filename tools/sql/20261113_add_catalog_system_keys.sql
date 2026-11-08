SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Multi-tenant catalog. The add-on types 'Size' (ingredient amounts hang on it) and 'Extra' (add-ons without a type) used
-- to be found by their fixed ids 1 and 4. Every shop now owns its own copy of the catalog with its own ids, so those two
-- types are marked with a SystemKey instead: 'size' and 'extra', unique per shop. Run after 20261110_enforce_tenant_id.
-- Safe to run twice; it only marks the two rows that still have their original ids and names.

IF COL_LENGTH(N'dbo.AddOnType', N'SystemKey') IS NULL
BEGIN
    ALTER TABLE dbo.AddOnType ADD SystemKey VARCHAR(20) NULL;
END
GO

UPDATE dbo.AddOnType SET SystemKey = 'size' WHERE SystemKey IS NULL AND Id = 1 AND Name = N'Size';
UPDATE dbo.AddOnType SET SystemKey = 'extra' WHERE SystemKey IS NULL AND Id = 4 AND Name = N'Extra';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_AddOnType_SystemKey' AND object_id = OBJECT_ID(N'dbo.AddOnType'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_AddOnType_SystemKey ON dbo.AddOnType (TenantId, SystemKey) WHERE SystemKey IS NOT NULL;
END
GO
