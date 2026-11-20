SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Multiple branches: an order that could not be saved after an offline sale now remembers the branch it was sold in, so
-- the Unsynced orders list shows only the selected branch. Run it with the branches script, right before the API that
-- knows about it is deployed. Existing rows take the branch named in the order the device sent (when that branch still
-- exists) or else the shop's Main branch. Safe to run twice. Never edits older scripts.

IF COL_LENGTH(N'dbo.UnsyncedOrders', N'BranchId') IS NULL
BEGIN
    ALTER TABLE dbo.UnsyncedOrders ADD BranchId UNIQUEIDENTIFIER NULL;
END
GO

UPDATE u SET BranchId = b.Id
FROM dbo.UnsyncedOrders u
JOIN dbo.Branches b ON b.TenantId = u.TenantId AND b.Id = TRY_CONVERT(UNIQUEIDENTIFIER, JSON_VALUE(u.QuotedOrderJson, '$.branchId'))
WHERE u.BranchId IS NULL AND ISJSON(u.QuotedOrderJson) = 1;

UPDATE u SET BranchId = b.Id
FROM dbo.UnsyncedOrders u
JOIN dbo.Branches b ON b.TenantId = u.TenantId AND b.IsMain = 1
WHERE u.BranchId IS NULL;
GO

IF EXISTS (SELECT 1 FROM dbo.UnsyncedOrders WHERE BranchId IS NULL)
BEGIN
    THROW 50000, N'dbo.UnsyncedOrders still has rows without a BranchId (a shop with no Main branch?). Run the branches script first.', 1;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.UnsyncedOrders') AND name = N'BranchId' AND is_nullable = 1)
BEGIN
    ALTER TABLE dbo.UnsyncedOrders ALTER COLUMN BranchId UNIQUEIDENTIFIER NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_UnsyncedOrders_Branches')
BEGIN
    ALTER TABLE dbo.UnsyncedOrders ADD CONSTRAINT FK_UnsyncedOrders_Branches FOREIGN KEY (BranchId) REFERENCES dbo.Branches (Id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UnsyncedOrders_BranchId' AND object_id = OBJECT_ID(N'dbo.UnsyncedOrders'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_UnsyncedOrders_BranchId ON dbo.UnsyncedOrders (BranchId);
END
GO
