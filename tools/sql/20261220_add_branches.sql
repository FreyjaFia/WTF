SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Multiple branches, build phase 1 (docs/roadmap/multiple-branches.md). Add, backfill, enforce, in one script.
-- Run it right before the API that knows about branches is deployed, after taking a backup. The previous API version
-- cannot insert orders or stock rows once BranchId is required, so there is no overlap window.
--   1. Branches (one "Main" per shop, created here for every tenant) and UserBranches (user to branch, many to many).
--      Users get DefaultBranchId (Main) and BranchScope (0 = All branches, 1 = Selected branches). Cashiers and
--      Stock Managers become Selected (Main only); everyone else stays All, so what they see today does not change.
--      Every user is assigned to Main.
--   2. BranchId on Orders, OrderSeniorPwdDiscounts, StockMovements, StockCounts, StockWastes, StockReceipts,
--      PurchaseOrders, Expenses, ShortLinks (order links) and AuditLog. Existing rows go to the shop's Main branch
--      (in batches), then the column becomes NOT NULL with a foreign key and an index.
--   3. Order numbers are counted per branch: TenantCounters gets one row per branch named OrderNumber:<branch id>,
--      copied from the shop's OrderNumber row (or the highest number in use plus one, if larger). The old row stays.
--      The unique index of order numbers becomes (TenantId, BranchId, OrderNumber). Printed numbers do not change.
-- Not in this script (build phase 4): ItemBranchStock and StockTransfers. Items.CurrentQuantity stays the stock until then.
-- Safe to run twice. Never edits older scripts.

IF OBJECT_ID(N'dbo.Branches', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Branches
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Branches_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL,
        Name NVARCHAR(100) NOT NULL,
        Code NVARCHAR(5) NOT NULL,
        Address NVARCHAR(300) NULL,
        Phone NVARCHAR(30) NULL,
        TimeZone NVARCHAR(64) NOT NULL CONSTRAINT DF_Branches_TimeZone DEFAULT (N'Asia/Manila'),
        IsActive BIT NOT NULL CONSTRAINT DF_Branches_IsActive DEFAULT (1),
        IsMain BIT NOT NULL CONSTRAINT DF_Branches_IsMain DEFAULT (0),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Branches_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CreatedBy UNIQUEIDENTIFIER NULL,
        UpdatedAt DATETIME2 NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_Branches PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_Branches_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Branches_TenantId_Code' AND object_id = OBJECT_ID(N'dbo.Branches'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_Branches_TenantId_Code ON dbo.Branches (TenantId, Code);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Branches_TenantId_Main' AND object_id = OBJECT_ID(N'dbo.Branches'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_Branches_TenantId_Main ON dbo.Branches (TenantId, IsMain) WHERE IsMain = 1;
END
GO

-- One Main branch per shop. The code is the first three letters of the shop name (MAIN when there are fewer than two).
INSERT INTO dbo.Branches (TenantId, Name, Code, IsActive, IsMain)
SELECT t.Id, N'Main',
       CASE WHEN LEN(letters.Value) >= 2 THEN UPPER(LEFT(letters.Value, 3)) ELSE N'MAIN' END,
       1, 1
FROM dbo.Tenants t
CROSS APPLY (SELECT REPLACE(TRANSLATE(t.Name, N' -.''&,0123456789', REPLICATE(N'~', 16)), N'~', N'') AS Value) letters
WHERE NOT EXISTS (SELECT 1 FROM dbo.Branches b WHERE b.TenantId = t.Id AND b.IsMain = 1);
GO

IF OBJECT_ID(N'dbo.UserBranches', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserBranches
    (
        UserId UNIQUEIDENTIFIER NOT NULL,
        BranchId UNIQUEIDENTIFIER NOT NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_UserBranches_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_UserBranches PRIMARY KEY CLUSTERED (UserId, BranchId),
        CONSTRAINT FK_UserBranches_Users FOREIGN KEY (UserId) REFERENCES dbo.Users (Id),
        CONSTRAINT FK_UserBranches_Branches FOREIGN KEY (BranchId) REFERENCES dbo.Branches (Id)
    );

    CREATE NONCLUSTERED INDEX IX_UserBranches_BranchId ON dbo.UserBranches (BranchId);
END
GO

IF COL_LENGTH(N'dbo.Users', N'DefaultBranchId') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD DefaultBranchId UNIQUEIDENTIFIER NULL;
END
GO

IF COL_LENGTH(N'dbo.Users', N'BranchScope') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD BranchScope TINYINT NOT NULL CONSTRAINT DF_Users_BranchScope DEFAULT (0);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Users_DefaultBranch')
BEGIN
    ALTER TABLE dbo.Users ADD CONSTRAINT FK_Users_DefaultBranch FOREIGN KEY (DefaultBranchId) REFERENCES dbo.Branches (Id);
END
GO

-- Everyone is assigned to Main; those without a default get Main. Cashier (2) and Stock Manager (6) are limited to it.
INSERT INTO dbo.UserBranches (UserId, BranchId, TenantId)
SELECT u.Id, b.Id, u.TenantId
FROM dbo.Users u
JOIN dbo.Branches b ON b.TenantId = u.TenantId AND b.IsMain = 1
WHERE NOT EXISTS (SELECT 1 FROM dbo.UserBranches ub WHERE ub.UserId = u.Id AND ub.BranchId = b.Id);

UPDATE u SET DefaultBranchId = b.Id
FROM dbo.Users u
JOIN dbo.Branches b ON b.TenantId = u.TenantId AND b.IsMain = 1
WHERE u.DefaultBranchId IS NULL;

-- Only while nobody has more than one branch yet: a second run after the owner changed scopes must not undo that.
IF NOT EXISTS (SELECT 1 FROM dbo.Branches WHERE IsMain = 0)
BEGIN
    UPDATE dbo.Users SET BranchScope = 1 WHERE RoleId IN (2, 6) AND BranchScope = 0;
END
GO

DECLARE @tables TABLE (Name SYSNAME NOT NULL);
INSERT INTO @tables (Name) VALUES
    ('AuditLog'), ('Expenses'), ('Orders'), ('OrderSeniorPwdDiscounts'), ('PurchaseOrders'), ('ShortLinks'),
    ('StockCounts'), ('StockMovements'), ('StockReceipts'), ('StockWastes');

DECLARE @name SYSNAME, @sql NVARCHAR(MAX);
DECLARE branch_tables CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @tables;
OPEN branch_tables;
FETCH NEXT FROM branch_tables INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID(N'dbo.' + QUOTENAME(@name), N'U') IS NULL
    BEGIN
        THROW 50000, N'A table that needs BranchId does not exist. Run the older scripts first.', 1;
    END

    IF COL_LENGTH(N'dbo.' + QUOTENAME(@name), N'BranchId') IS NULL
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' ADD BranchId UNIQUEIDENTIFIER NULL;';
        EXEC sys.sp_executesql @sql;
    END

    FETCH NEXT FROM branch_tables INTO @name;
END
CLOSE branch_tables;
DEALLOCATE branch_tables;
GO

-- Backfill in batches of 5000 so the log stays small on big tables (AuditLog, Orders, StockMovements).
DECLARE @tables TABLE (Name SYSNAME NOT NULL);
INSERT INTO @tables (Name) VALUES
    ('AuditLog'), ('Expenses'), ('Orders'), ('OrderSeniorPwdDiscounts'), ('PurchaseOrders'), ('ShortLinks'),
    ('StockCounts'), ('StockMovements'), ('StockReceipts'), ('StockWastes');

DECLARE @name SYSNAME, @sql NVARCHAR(MAX), @rows INT;
DECLARE branch_fill CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @tables;
OPEN branch_fill;
FETCH NEXT FROM branch_fill INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'UPDATE TOP (5000) t SET BranchId = b.Id FROM dbo.' + QUOTENAME(@name) + N' t '
        + N'JOIN dbo.Branches b ON b.TenantId = t.TenantId AND b.IsMain = 1 WHERE t.BranchId IS NULL;';
    SET @rows = 1;
    WHILE @rows > 0
    BEGIN
        EXEC sys.sp_executesql @sql;
        SET @rows = @@ROWCOUNT;
    END

    FETCH NEXT FROM branch_fill INTO @name;
END
CLOSE branch_fill;
DEALLOCATE branch_fill;
GO

DECLARE @tables TABLE (Name SYSNAME NOT NULL);
INSERT INTO @tables (Name) VALUES
    ('AuditLog'), ('Expenses'), ('Orders'), ('OrderSeniorPwdDiscounts'), ('PurchaseOrders'), ('ShortLinks'),
    ('StockCounts'), ('StockMovements'), ('StockReceipts'), ('StockWastes');

DECLARE @name SYSNAME, @sql NVARCHAR(MAX), @left INT, @message NVARCHAR(200);
DECLARE branch_enforce CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @tables;
OPEN branch_enforce;
FETCH NEXT FROM branch_enforce INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'SELECT @left = COUNT(*) FROM dbo.' + QUOTENAME(@name) + N' WHERE BranchId IS NULL';
    EXEC sys.sp_executesql @sql, N'@left INT OUTPUT', @left = @left OUTPUT;
    IF @left > 0
    BEGIN
        SET @message = N'dbo.' + @name + N' still has rows without a BranchId (a row of a shop with no Main branch?).';
        THROW 50000, @message, 1;
    END

    IF EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@name)) AND name = N'BranchId' AND is_nullable = 1)
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' ALTER COLUMN BranchId UNIQUEIDENTIFIER NOT NULL;';
        EXEC sys.sp_executesql @sql;
    END

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_' + @name + N'_Branches')
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' ADD CONSTRAINT ' + QUOTENAME(N'FK_' + @name + N'_Branches')
            + N' FOREIGN KEY (BranchId) REFERENCES dbo.Branches (Id);';
        EXEC sys.sp_executesql @sql;
    END

    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = N'IX_' + @name + N'_BranchId' AND object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@name)))
    BEGIN
        SET @sql = N'CREATE NONCLUSTERED INDEX ' + QUOTENAME(N'IX_' + @name + N'_BranchId')
            + N' ON dbo.' + QUOTENAME(@name) + N' (BranchId);';
        EXEC sys.sp_executesql @sql;
    END

    FETCH NEXT FROM branch_enforce INTO @name;
END
CLOSE branch_enforce;
DEALLOCATE branch_enforce;
GO

-- Order numbers per branch. Main continues the shop's counter; the old OrderNumber row stays for the previous API version.
INSERT INTO dbo.TenantCounters (TenantId, Name, NextValue)
SELECT b.TenantId, 'OrderNumber:' + LOWER(CONVERT(VARCHAR(36), b.Id)),
       CASE WHEN ISNULL(c.NextValue, 1) > ISNULL(h.Highest, 0) + 1 THEN ISNULL(c.NextValue, 1) ELSE ISNULL(h.Highest, 0) + 1 END
FROM dbo.Branches b
LEFT JOIN dbo.TenantCounters c ON c.TenantId = b.TenantId AND c.Name = 'OrderNumber'
OUTER APPLY (SELECT MAX(CONVERT(BIGINT, o.OrderNumber)) AS Highest FROM dbo.Orders o WHERE o.TenantId = b.TenantId AND o.BranchId = b.Id) h
WHERE b.IsMain = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.TenantCounters x
                  WHERE x.TenantId = b.TenantId AND x.Name = 'OrderNumber:' + LOWER(CONVERT(VARCHAR(36), b.Id)));
GO

IF EXISTS (SELECT 1 FROM sys.indexes i
           JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
           WHERE i.name = N'UQ_Orders_OrderNumber' AND i.object_id = OBJECT_ID(N'dbo.Orders')
           GROUP BY i.index_id HAVING COUNT(*) = 2)
BEGIN
    DROP INDEX UQ_Orders_OrderNumber ON dbo.Orders;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Orders_OrderNumber' AND object_id = OBJECT_ID(N'dbo.Orders'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Orders_OrderNumber ON dbo.Orders (TenantId, BranchId, OrderNumber);
END
GO
