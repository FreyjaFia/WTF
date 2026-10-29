SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Waste and spoilage (Inventory Phase 5). Stock that left without a sale is recorded with a reason:
--   WasteReasons               - the list of reasons the owner can edit. "Other" is a system reason that needs a note.
--   StockWastes                - one row per waste entry: item, quantity, reason (and a snapshot of its name), note,
--                                status (1 Recorded, 2 PendingReview, 3 Confirmed, 4 Disputed, 5 Reversed), review and
--                                reversal details, and the movements it wrote. The stock is always taken at once; an entry
--                                above the item's limit only waits for an Admin to confirm or dispute it.
--   Items.WasteApprovalLimit   - waste above this quantity (base unit) needs review. NULL = never.
--   StockMovements.MovementType - adds WasteReversed (a reversal puts the quantity back with a new movement).
-- Refund waste written by a void ("Refunded, not resaleable") has no StockWastes row and is left as it is. Safe to run twice.

-- Items.WasteApprovalLimit
IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Items', N'WasteApprovalLimit') IS NULL
BEGIN
    ALTER TABLE dbo.Items ADD WasteApprovalLimit DECIMAL(18, 3) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Items', N'WasteApprovalLimit') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_WasteApprovalLimit')
BEGIN
    ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_WasteApprovalLimit
        CHECK (WasteApprovalLimit IS NULL OR WasteApprovalLimit >= 0);
END;
GO

-- WasteReasons
IF OBJECT_ID(N'dbo.WasteReasons', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.WasteReasons
    (
        Id INT IDENTITY(1, 1) NOT NULL,
        Name NVARCHAR(60) NOT NULL,
        RequiresNote BIT NOT NULL
            CONSTRAINT DF_WasteReasons_RequiresNote DEFAULT 0,
        SortOrder INT NOT NULL
            CONSTRAINT DF_WasteReasons_SortOrder DEFAULT 0,
        IsActive BIT NOT NULL
            CONSTRAINT DF_WasteReasons_IsActive DEFAULT 1,
        IsSystem BIT NOT NULL
            CONSTRAINT DF_WasteReasons_IsSystem DEFAULT 0,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_WasteReasons_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NULL,
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_WasteReasons PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_WasteReasons_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_WasteReasons_UpdatedBy FOREIGN KEY (UpdatedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.WasteReasons', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'UX_WasteReasons_Name' AND object_id = OBJECT_ID(N'dbo.WasteReasons'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_WasteReasons_Name
        ON dbo.WasteReasons(Name);
END;
GO

-- Seed reasons (by name, so a renamed or added reason is never duplicated)
IF OBJECT_ID(N'dbo.WasteReasons', N'U') IS NOT NULL
BEGIN
    INSERT INTO dbo.WasteReasons (Name, RequiresNote, SortOrder, IsSystem)
    SELECT s.Name, s.RequiresNote, s.SortOrder, s.IsSystem
    FROM (VALUES
        (N'Expired or spoiled', 0, 10, 0),
        (N'Spilled or dropped', 0, 20, 0),
        (N'Wrong order or remade', 0, 30, 0),
        (N'Quality failed', 0, 40, 0),
        (N'Staff meal', 0, 50, 0),
        (N'Sample or tasting', 0, 60, 0),
        (N'Breakage', 0, 70, 0),
        (N'Other', 1, 1000, 1)
    ) AS s(Name, RequiresNote, SortOrder, IsSystem)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WasteReasons r WHERE r.Name = s.Name);
END;
GO

-- StockWastes
IF OBJECT_ID(N'dbo.StockWastes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockWastes
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockWastes_Id DEFAULT NEWID(),
        ItemId UNIQUEIDENTIFIER NOT NULL,
        StockMovementId UNIQUEIDENTIFIER NOT NULL,
        Quantity DECIMAL(18, 3) NOT NULL,
        WasteReasonId INT NOT NULL,
        ReasonName NVARCHAR(60) NOT NULL,
        Notes NVARCHAR(500) NULL,
        Status TINYINT NOT NULL
            CONSTRAINT DF_StockWastes_Status DEFAULT 1,
        RequiresReview BIT NOT NULL
            CONSTRAINT DF_StockWastes_RequiresReview DEFAULT 0,
        ReviewedAt DATETIME2(7) NULL,
        ReviewedBy UNIQUEIDENTIFIER NULL,
        ReviewNote NVARCHAR(500) NULL,
        ReversedAt DATETIME2(7) NULL,
        ReversedBy UNIQUEIDENTIFIER NULL,
        ReversalReason NVARCHAR(500) NULL,
        ReversalMovementId UNIQUEIDENTIFIER NULL,
        Source TINYINT NOT NULL
            CONSTRAINT DF_StockWastes_Source DEFAULT 1,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_StockWastes_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_StockWastes PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_StockWastes_Items FOREIGN KEY (ItemId)
            REFERENCES dbo.Items(Id),
        CONSTRAINT FK_StockWastes_StockMovements FOREIGN KEY (StockMovementId)
            REFERENCES dbo.StockMovements(Id),
        CONSTRAINT FK_StockWastes_ReversalMovement FOREIGN KEY (ReversalMovementId)
            REFERENCES dbo.StockMovements(Id),
        CONSTRAINT FK_StockWastes_WasteReasons FOREIGN KEY (WasteReasonId)
            REFERENCES dbo.WasteReasons(Id),
        CONSTRAINT FK_StockWastes_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_StockWastes_ReviewedBy FOREIGN KEY (ReviewedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_StockWastes_ReversedBy FOREIGN KEY (ReversedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT CK_StockWastes_Quantity CHECK (Quantity > 0),
        CONSTRAINT CK_StockWastes_Status CHECK (Status IN (1, 2, 3, 4, 5)),
        CONSTRAINT CK_StockWastes_Source CHECK (Source IN (1, 2))
    );
END;
GO

IF OBJECT_ID(N'dbo.StockWastes', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_StockWastes_CreatedAt' AND object_id = OBJECT_ID(N'dbo.StockWastes'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockWastes_CreatedAt
        ON dbo.StockWastes(CreatedAt);
END;
GO

IF OBJECT_ID(N'dbo.StockWastes', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_StockWastes_Status' AND object_id = OBJECT_ID(N'dbo.StockWastes'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockWastes_Status
        ON dbo.StockWastes(Status);
END;
GO

IF OBJECT_ID(N'dbo.StockWastes', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_StockWastes_Item_Created' AND object_id = OBJECT_ID(N'dbo.StockWastes'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockWastes_Item_Created
        ON dbo.StockWastes(ItemId, CreatedAt);
END;
GO

-- Movement types: add WasteReversed
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockMovements_MovementType')
   AND NOT EXISTS (
       SELECT 1 FROM sys.check_constraints
       WHERE name = N'CK_StockMovements_MovementType' AND definition LIKE N'%WasteReversed%')
BEGIN
    ALTER TABLE dbo.StockMovements DROP CONSTRAINT CK_StockMovements_MovementType;
END;
GO

IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockMovements_MovementType')
BEGIN
    ALTER TABLE dbo.StockMovements ADD CONSTRAINT CK_StockMovements_MovementType CHECK (
        MovementType IN (
            N'AddStock',
            N'Sale',
            N'SaleVoid',
            N'Waste',
            N'WasteReversed',
            N'Adjustment',
            N'SaleDeduction',
            N'ManualAdjustment',
            N'Correction',
            N'Spoilage'
        )
    );
END;
GO

-- Idempotent recording: a retried request with the same client request id returns the entry it already saved.
IF COL_LENGTH(N'dbo.StockWastes', N'ClientRequestId') IS NULL
BEGIN
    ALTER TABLE dbo.StockWastes ADD ClientRequestId UNIQUEIDENTIFIER NULL;
END;
GO

IF OBJECT_ID(N'dbo.StockWastes', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'UX_StockWastes_ClientRequestId' AND object_id = OBJECT_ID(N'dbo.StockWastes'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_StockWastes_ClientRequestId
        ON dbo.StockWastes(ClientRequestId)
        WHERE ClientRequestId IS NOT NULL;
END;
GO