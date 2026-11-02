SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Stock counts (Inventory Phase 7, slice 1). A count is a session in which someone walks the shelves and enters what is
-- physically there; posting it writes one Count movement per item that differs, on top of the balance at that moment:
--   StockCounts      - one row per session: name, status (1 Open, 2 Posted, 3 Cancelled), blind or not (a blind count
--                      hides the expected balance from the counter until it is posted), who started, posted or cancelled it.
--   StockCountLines  - one row per item in the session: the quantity counted, and the balance the system showed at the
--                      moment it was entered (ExpectedQuantity). The difference is counted minus expected, so sales made
--                      after the item was counted are never undone by posting.
-- StockMovements gets no new column: a posted line is a movement of type Count with ReferenceType StockCount and the
-- count's id as ReferenceId. Safe to run twice.

IF OBJECT_ID(N'dbo.StockCounts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockCounts
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockCounts_Id DEFAULT (NEWID()),
        Name NVARCHAR(100) NOT NULL,
        Status TINYINT NOT NULL
            CONSTRAINT DF_StockCounts_Status DEFAULT 1,
        IsBlind BIT NOT NULL
            CONSTRAINT DF_StockCounts_IsBlind DEFAULT 0,
        Note NVARCHAR(500) NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_StockCounts_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        PostedAt DATETIME2(7) NULL,
        PostedBy UNIQUEIDENTIFIER NULL,
        CancelledAt DATETIME2(7) NULL,
        CancelledBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_StockCounts PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_StockCounts_Status CHECK (Status IN (1, 2, 3)),
        CONSTRAINT FK_StockCounts_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_StockCounts_PostedBy FOREIGN KEY (PostedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_StockCounts_CancelledBy FOREIGN KEY (CancelledBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.StockCounts', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockCounts_Status_CreatedAt' AND object_id = OBJECT_ID(N'dbo.StockCounts'))
BEGIN
    CREATE INDEX IX_StockCounts_Status_CreatedAt ON dbo.StockCounts (Status, CreatedAt DESC);
END;
GO

IF OBJECT_ID(N'dbo.StockCountLines', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockCountLines
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockCountLines_Id DEFAULT (NEWID()),
        CountId UNIQUEIDENTIFIER NOT NULL,
        ItemId UNIQUEIDENTIFIER NOT NULL,
        CountedQuantity DECIMAL(18, 3) NULL,
        ExpectedQuantity DECIMAL(18, 3) NULL,
        CountedAt DATETIME2(7) NULL,
        CountedBy UNIQUEIDENTIFIER NULL,
        MovementId UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_StockCountLines PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT UQ_StockCountLines_CountItem UNIQUE (CountId, ItemId),
        CONSTRAINT CK_StockCountLines_Counted CHECK (CountedQuantity IS NULL OR CountedQuantity >= 0),
        CONSTRAINT FK_StockCountLines_Count FOREIGN KEY (CountId)
            REFERENCES dbo.StockCounts(Id),
        CONSTRAINT FK_StockCountLines_Item FOREIGN KEY (ItemId)
            REFERENCES dbo.Items(Id),
        CONSTRAINT FK_StockCountLines_CountedBy FOREIGN KEY (CountedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

-- Movement types: add Count
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockMovements_MovementType')
   AND NOT EXISTS (
       SELECT 1 FROM sys.check_constraints
       WHERE name = N'CK_StockMovements_MovementType' AND definition LIKE N'%N''Count''%')
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
            N'Count',
            N'SaleDeduction',
            N'ManualAdjustment',
            N'Correction',
            N'Spoilage'
        )
    );
END;
GO
