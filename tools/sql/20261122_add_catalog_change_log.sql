SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Offline Phase 7b: CatalogChangeLog (see docs/roadmap/offline.md). One row per changed field of what an offline sale is
-- judged against, written by the API in the same transaction as the change:
--   EntityType   Product, ProductAddOnPriceOverride, Promotion, TenantSettings, Baseline.
--   EntityId     Product id; a name-based id of (product, add-on) for an override; promotion id (discount, bundle and
--                mix-and-match alike); tenant id for TenantSettings and Baseline.
--   Field        Price, IsActive, ... ; "Rule:<product id>" and "Item:<product id>" for the lines of a promotion; "Created"
--                for a new row. OldValue is NULL when the field did not exist or was empty before, NewValue is NULL when it
--                is gone or empty now. Values are invariant text (decimals "0.00", booleans true/false, ISO dates/times).
--   EffectiveFrom UTC moment the change took effect = the moment it was saved, also for a promotion start or end date (the
--                date itself is a value in the row). Rows are never edited; they only get added.
--   Baseline     One row per shop (Field "LogStarted") marks when logging began. Before it the log knows nothing, so the
--                app falls back to today's behavior for older data. Run this script right before the new API goes live.
-- Safe to run twice.

IF OBJECT_ID(N'dbo.CatalogChangeLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CatalogChangeLog
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_CatalogChangeLog_Id DEFAULT (NEWID()),
        EntityType NVARCHAR(40) NOT NULL,
        EntityId UNIQUEIDENTIFIER NOT NULL,
        Field NVARCHAR(100) NOT NULL,
        OldValue NVARCHAR(2000) NULL,
        NewValue NVARCHAR(2000) NULL,
        EffectiveFrom DATETIME2(7) NOT NULL,
        ChangedBy UNIQUEIDENTIFIER NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_CatalogChangeLog_CreatedAt DEFAULT GETUTCDATE(),
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_CatalogChangeLog_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_CatalogChangeLog PRIMARY KEY (Id),
        CONSTRAINT FK_CatalogChangeLog_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CatalogChangeLog_TenantId_EntityType_EntityId_EffectiveFrom' AND object_id = OBJECT_ID(N'dbo.CatalogChangeLog'))
BEGIN
    CREATE INDEX IX_CatalogChangeLog_TenantId_EntityType_EntityId_EffectiveFrom
        ON dbo.CatalogChangeLog (TenantId, EntityType, EntityId, EffectiveFrom);
END
GO

INSERT INTO dbo.CatalogChangeLog (Id, EntityType, EntityId, Field, OldValue, NewValue, EffectiveFrom, ChangedBy, CreatedAt, TenantId)
SELECT NEWID(), N'Baseline', t.Id, N'LogStarted', NULL, N'1', GETUTCDATE(), NULL, GETUTCDATE(), t.Id
FROM dbo.Tenants AS t
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.CatalogChangeLog AS l
    WHERE l.TenantId = t.Id AND l.EntityType = N'Baseline' AND l.EntityId = t.Id);
GO
