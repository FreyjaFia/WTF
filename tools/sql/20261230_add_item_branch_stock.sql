SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Multiple branches, phase 4: stock by branch (docs/roadmap/multiple-branches.md). Run after 20261220 and 20261221, and
-- right before the API that reads ItemBranchStock is deployed (the old API keeps writing Items.CurrentQuantity, which the
-- new API no longer reads, so the two must not overlap).
--   1. ItemBranchStock: one row per item and branch with the quantity and the last stock alert status that branch sent.
--      The item keeps its name, unit, cost, warning and critical levels, par level and negative-stock setting for the
--      whole shop.
--   2. Backfill: every item's current quantity and alert status go to its shop's Main branch. Every other branch gets
--      a zero row for every item (a new branch starts with no stock). Rows that exist are never changed.
--   3. StockTransfers and StockTransferLines: the audit trail of goods moved from one branch to another.
-- Items.CurrentQuantity and Items.LastAlertStatus stay in the table as the last pre-branch values (a way back, never read).
-- Safe to run twice.

IF OBJECT_ID(N'dbo.ItemBranchStock', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItemBranchStock
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ItemBranchStock_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL,
        ItemId UNIQUEIDENTIFIER NOT NULL,
        BranchId UNIQUEIDENTIFIER NOT NULL,
        CurrentQuantity DECIMAL(18, 3) NOT NULL CONSTRAINT DF_ItemBranchStock_Qty DEFAULT (0),
        LastAlertStatus TINYINT NOT NULL CONSTRAINT DF_ItemBranchStock_Alert DEFAULT (0),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ItemBranchStock_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ItemBranchStock PRIMARY KEY (Id),
        CONSTRAINT FK_ItemBranchStock_Items FOREIGN KEY (ItemId) REFERENCES dbo.Items (Id),
        CONSTRAINT FK_ItemBranchStock_Branches FOREIGN KEY (BranchId) REFERENCES dbo.Branches (Id),
        CONSTRAINT FK_ItemBranchStock_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT UQ_ItemBranchStock_ItemBranch UNIQUE (ItemId, BranchId)
    );

    CREATE INDEX IX_ItemBranchStock_BranchId ON dbo.ItemBranchStock (BranchId);
END
GO

-- Main branch rows carry the existing quantity.
INSERT INTO dbo.ItemBranchStock (TenantId, ItemId, BranchId, CurrentQuantity, LastAlertStatus)
SELECT i.TenantId, i.Id, b.Id, i.CurrentQuantity, i.LastAlertStatus
FROM dbo.Items i
JOIN dbo.Branches b ON b.TenantId = i.TenantId AND b.IsMain = 1
WHERE NOT EXISTS (SELECT 1 FROM dbo.ItemBranchStock s WHERE s.ItemId = i.Id AND s.BranchId = b.Id);
GO

-- Every other branch starts at zero.
INSERT INTO dbo.ItemBranchStock (TenantId, ItemId, BranchId, CurrentQuantity, LastAlertStatus)
SELECT i.TenantId, i.Id, b.Id, 0, 0
FROM dbo.Items i
JOIN dbo.Branches b ON b.TenantId = i.TenantId AND b.IsMain = 0
WHERE NOT EXISTS (SELECT 1 FROM dbo.ItemBranchStock s WHERE s.ItemId = i.Id AND s.BranchId = b.Id);
GO

IF OBJECT_ID(N'dbo.StockTransfers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockTransfers
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_StockTransfers_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL,
        FromBranchId UNIQUEIDENTIFIER NOT NULL,
        ToBranchId UNIQUEIDENTIFIER NOT NULL,
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_StockTransfers_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_StockTransfers PRIMARY KEY (Id),
        CONSTRAINT FK_StockTransfers_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT FK_StockTransfers_FromBranch FOREIGN KEY (FromBranchId) REFERENCES dbo.Branches (Id),
        CONSTRAINT FK_StockTransfers_ToBranch FOREIGN KEY (ToBranchId) REFERENCES dbo.Branches (Id),
        CONSTRAINT FK_StockTransfers_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users (Id),
        CONSTRAINT CK_StockTransfers_DifferentBranches CHECK (FromBranchId <> ToBranchId)
    );

    CREATE INDEX IX_StockTransfers_FromBranch ON dbo.StockTransfers (FromBranchId, CreatedAt DESC);
    CREATE INDEX IX_StockTransfers_ToBranch ON dbo.StockTransfers (ToBranchId, CreatedAt DESC);
END
GO

IF OBJECT_ID(N'dbo.StockTransferLines', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockTransferLines
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_StockTransferLines_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL,
        TransferId UNIQUEIDENTIFIER NOT NULL,
        ItemId UNIQUEIDENTIFIER NOT NULL,
        Quantity DECIMAL(18, 3) NOT NULL,
        UnitCost DECIMAL(18, 6) NULL,
        CONSTRAINT PK_StockTransferLines PRIMARY KEY (Id),
        CONSTRAINT FK_StockTransferLines_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT FK_StockTransferLines_Transfers FOREIGN KEY (TransferId) REFERENCES dbo.StockTransfers (Id),
        CONSTRAINT FK_StockTransferLines_Items FOREIGN KEY (ItemId) REFERENCES dbo.Items (Id),
        CONSTRAINT CK_StockTransferLines_Quantity CHECK (Quantity > 0)
    );

    CREATE INDEX IX_StockTransferLines_TransferId ON dbo.StockTransferLines (TransferId);
END
GO
