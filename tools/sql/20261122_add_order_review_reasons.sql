SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Offline Phase 7a (see docs/roadmap/offline.md): structured reasons for an offline sale that met a changed catalog.
--   OrderReviewReasons   - one row per reason: Code (PriceChanged, ProductInactive, ...), Severity (1 Hold: needs an Admin
--                          decision, 2 Note: saved as sold, informational), the quoted and expected values, the text shown to
--                          people and the position of the line it is about. Append-only: written with the order, never edited.
--   Orders.CatalogSyncedAt - when the device last updated its catalog, as the device reported it (audit and, later, the
--                          sale-time judgement).
-- Orders.ReviewReasons keeps the joined text of the Hold reasons, so old orders and old apps read as before.
-- Safe to run twice; it never changes an existing row.

IF OBJECT_ID(N'dbo.OrderReviewReasons', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OrderReviewReasons
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_OrderReviewReasons_Id DEFAULT (NEWID()),
        OrderId UNIQUEIDENTIFIER NOT NULL,
        SortOrder INT NOT NULL,
        LineIndex INT NULL,
        Code NVARCHAR(40) NOT NULL,
        Severity TINYINT NOT NULL,
        ExpectedValue NVARCHAR(60) NULL,
        QuotedValue NVARCHAR(60) NULL,
        [Text] NVARCHAR(300) NOT NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_OrderReviewReasons_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_OrderReviewReasons PRIMARY KEY (Id),
        CONSTRAINT FK_OrderReviewReasons_Order FOREIGN KEY (OrderId) REFERENCES dbo.Orders (Id),
        CONSTRAINT FK_OrderReviewReasons_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OrderReviewReasons_OrderId' AND object_id = OBJECT_ID(N'dbo.OrderReviewReasons'))
BEGIN
    CREATE INDEX IX_OrderReviewReasons_OrderId ON dbo.OrderReviewReasons (OrderId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OrderReviewReasons_TenantId_Code' AND object_id = OBJECT_ID(N'dbo.OrderReviewReasons'))
BEGIN
    CREATE INDEX IX_OrderReviewReasons_TenantId_Code ON dbo.OrderReviewReasons (TenantId, Code);
END
GO

IF COL_LENGTH(N'dbo.Orders', N'CatalogSyncedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD CatalogSyncedAt DATETIME2(7) NULL;
END
GO
