SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Temperature (Hot / Iced) add-on type.
--   ProductAddOns.IsDefault - the option of a required add-on type that the register pre-selects on that product (at most
--                             one per product and type; the API clears it when the link is removed or its type changes).
--   AddOnType 'Temperature' - one row per shop that has none yet: required, pick exactly one, sorted before Size so a line
--                             reads "Latte, Iced, Large". Catalog ids are chosen by the app and are unique across shops, so
--                             each new row takes the next free id. A shop that already created its own type named
--                             Temperature is left alone. The Hot and Iced options are add-on products the owner creates
--                             and links in the product editor; nothing is linked or priced here.
-- Run it after 20261113_add_catalog_system_keys.sql. Safe to run twice; it never changes an existing row.

IF COL_LENGTH(N'dbo.ProductAddOns', N'IsDefault') IS NULL
BEGIN
    ALTER TABLE dbo.ProductAddOns ADD IsDefault BIT NOT NULL CONSTRAINT DF_ProductAddOns_IsDefault DEFAULT (0);
END
GO

BEGIN TRANSACTION;

DECLARE @tenantId UNIQUEIDENTIFIER;
DECLARE tenants CURSOR LOCAL FAST_FORWARD FOR
    SELECT t.Id FROM dbo.Tenants t
    WHERE NOT EXISTS (SELECT 1 FROM dbo.AddOnType a WHERE a.TenantId = t.Id AND a.Name = N'Temperature');

OPEN tenants;
FETCH NEXT FROM tenants INTO @tenantId;
WHILE @@FETCH_STATUS = 0
BEGIN
    INSERT INTO dbo.AddOnType (Id, Name, TenantId, IsRequired, MinSelect, MaxSelect, SortOrder, IsActive)
    SELECT ISNULL(MAX(Id), 0) + 1, N'Temperature', @tenantId, 1, 1, 1, 0, 1 FROM dbo.AddOnType;

    FETCH NEXT FROM tenants INTO @tenantId;
END
CLOSE tenants;
DEALLOCATE tenants;

COMMIT TRANSACTION;
GO
