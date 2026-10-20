SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Global notifications. StockNotifications (stock alerts only) becomes Notifications, which holds any kind of
-- notification for a person, so a new kind needs no new table, badge or push wiring:
--   Kind        - what it is ('StockAlert' for every existing row)
--   Severity    - 0 info, 1 warning, 2 critical
--   Path        - where it opens in the app
--   SubjectId   - what it is about (the item, the order, the promotion)
--   Data        - JSON for what only that kind needs (a stock alert keeps its level and quantity there)
-- The stock-only columns (ItemId, Status, Quantity) move into SubjectId, Severity and Data. Existing rows keep their
-- read state. Safe to run twice.

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.Notifications', N'U') IS NULL
BEGIN
    EXEC(N'ALTER TABLE dbo.StockNotifications ADD
        Kind VARCHAR(40) NOT NULL CONSTRAINT DF_StockNotifications_Kind DEFAULT ''StockAlert'',
        Severity TINYINT NOT NULL CONSTRAINT DF_StockNotifications_Severity DEFAULT 0,
        Path NVARCHAR(200) NULL,
        SubjectId UNIQUEIDENTIFIER NULL,
        Data NVARCHAR(MAX) NULL');
END;
GO

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.StockNotifications', N'ItemId') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.StockNotifications
        SET SubjectId = ItemId,
            Severity = CASE WHEN Status = 1 THEN 1 ELSE 2 END,
            Path = N''/inventory/items/details/'' + LOWER(CONVERT(NVARCHAR(36), ItemId)),
            Data = N''{"status":'' + CONVERT(NVARCHAR(3), Status) + N'',"quantity":'' + CONVERT(NVARCHAR(40), Quantity) + N''}''');

    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_StockNotifications_Items')
        EXEC(N'ALTER TABLE dbo.StockNotifications DROP CONSTRAINT FK_StockNotifications_Items');
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockNotifications_Status')
        EXEC(N'ALTER TABLE dbo.StockNotifications DROP CONSTRAINT CK_StockNotifications_Status');
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockNotifications_ItemId' AND object_id = OBJECT_ID(N'dbo.StockNotifications'))
        EXEC(N'DROP INDEX IX_StockNotifications_ItemId ON dbo.StockNotifications');
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockNotifications_Item_User_Created' AND object_id = OBJECT_ID(N'dbo.StockNotifications'))
        EXEC(N'DROP INDEX IX_StockNotifications_Item_User_Created ON dbo.StockNotifications');

    EXEC(N'ALTER TABLE dbo.StockNotifications DROP COLUMN ItemId, Status, Quantity');
END;
GO

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.Notifications', N'U') IS NULL
BEGIN
    EXEC sp_rename N'dbo.StockNotifications', N'Notifications';
    EXEC sp_rename N'dbo.PK_StockNotifications', N'PK_Notifications', N'OBJECT';
    EXEC sp_rename N'dbo.FK_StockNotifications_Users', N'FK_Notifications_Users', N'OBJECT';
    EXEC sp_rename N'dbo.DF_StockNotifications_Id', N'DF_Notifications_Id', N'OBJECT';
    EXEC sp_rename N'dbo.DF_StockNotifications_CreatedAt', N'DF_Notifications_CreatedAt', N'OBJECT';
    EXEC sp_rename N'dbo.DF_StockNotifications_ReminderCount', N'DF_Notifications_ReminderCount', N'OBJECT';
    EXEC sp_rename N'dbo.DF_StockNotifications_Kind', N'DF_Notifications_Kind', N'OBJECT';
    EXEC sp_rename N'dbo.DF_StockNotifications_Severity', N'DF_Notifications_Severity', N'OBJECT';
    EXEC sp_rename N'dbo.Notifications.IX_StockNotifications_User_Read_Created', N'IX_Notifications_User_Read_Created', N'INDEX';
END;
GO

IF OBJECT_ID(N'dbo.Notifications', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_Notifications_User_Kind_Read' AND object_id = OBJECT_ID(N'dbo.Notifications'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Notifications_User_Kind_Read
        ON dbo.Notifications(UserId, Kind, ReadAt);
END;
GO

IF OBJECT_ID(N'dbo.Notifications', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_Notifications_Kind_Subject_User_Created' AND object_id = OBJECT_ID(N'dbo.Notifications'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Notifications_Kind_Subject_User_Created
        ON dbo.Notifications(Kind, SubjectId, UserId, CreatedAt DESC);
END;
GO
