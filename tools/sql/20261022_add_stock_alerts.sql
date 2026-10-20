SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Stock alerts (Inventory Phase 4). When an item falls to a worse level (warning, critical, out of stock) the people who
-- look after stock are told once, by push and in a saved list:
--   Items.LastAlertStatus      - the level the last alert was sent for (0 ok, 1 warning, 2 critical, 3 out of stock).
--                                An item is alerted again only when it gets worse than this, or after it was back to ok.
--                                Existing items start at their current level, so nothing floods on the first run.
--   StockNotifications         - one row per alert per person: the in-app list, with its own read time
--   ItemAlertRecipients        - optional: the people told about one item. No rows = the stock roles are told.

-- Items.LastAlertStatus
IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Items', N'LastAlertStatus') IS NULL
BEGIN
    ALTER TABLE dbo.Items ADD LastAlertStatus TINYINT NOT NULL
        CONSTRAINT DF_Items_LastAlertStatus DEFAULT 0;

    EXEC(N'
        UPDATE dbo.Items
        SET LastAlertStatus = CASE
            WHEN CurrentQuantity <= 0 THEN 3
            WHEN CriticalQuantity IS NOT NULL AND CurrentQuantity <= CriticalQuantity THEN 2
            WHEN WarningQuantity IS NOT NULL AND CurrentQuantity <= WarningQuantity THEN 1
            ELSE 0 END');
END;
GO

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockNotifications
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockNotifications_Id DEFAULT NEWID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        ItemId UNIQUEIDENTIFIER NOT NULL,
        Status TINYINT NOT NULL,
        Quantity DECIMAL(18, 3) NOT NULL,
        Title NVARCHAR(150) NOT NULL,
        Body NVARCHAR(300) NOT NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_StockNotifications_CreatedAt DEFAULT GETUTCDATE(),
        ReadAt DATETIME2(7) NULL,
        CONSTRAINT PK_StockNotifications PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_StockNotifications_Users FOREIGN KEY (UserId)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_StockNotifications_Items FOREIGN KEY (ItemId)
            REFERENCES dbo.Items(Id),
        CONSTRAINT CK_StockNotifications_Status CHECK (Status IN (1, 2, 3))
    );
END;
GO

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_StockNotifications_User_Read_Created' AND object_id = OBJECT_ID(N'dbo.StockNotifications'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockNotifications_User_Read_Created
        ON dbo.StockNotifications(UserId, ReadAt, CreatedAt DESC);
END;
GO

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_StockNotifications_ItemId' AND object_id = OBJECT_ID(N'dbo.StockNotifications'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockNotifications_ItemId
        ON dbo.StockNotifications(ItemId);
END;
GO

IF OBJECT_ID(N'dbo.ItemAlertRecipients', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItemAlertRecipients
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ItemAlertRecipients_Id DEFAULT NEWID(),
        ItemId UNIQUEIDENTIFIER NOT NULL,
        UserId UNIQUEIDENTIFIER NOT NULL,
        IsActive BIT NOT NULL
            CONSTRAINT DF_ItemAlertRecipients_IsActive DEFAULT 1,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_ItemAlertRecipients_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_ItemAlertRecipients PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_ItemAlertRecipients_Items FOREIGN KEY (ItemId)
            REFERENCES dbo.Items(Id),
        CONSTRAINT FK_ItemAlertRecipients_Users FOREIGN KEY (UserId)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_ItemAlertRecipients_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.ItemAlertRecipients', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'UX_ItemAlertRecipients_Item_User' AND object_id = OBJECT_ID(N'dbo.ItemAlertRecipients'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_ItemAlertRecipients_Item_User
        ON dbo.ItemAlertRecipients(ItemId, UserId);
END;
GO
