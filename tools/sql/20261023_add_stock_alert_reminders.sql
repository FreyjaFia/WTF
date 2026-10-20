SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Daily stock reminders (Inventory Phase 4 follow-up). An item that stays at a warning, critical or empty level reminds the
-- same people again each day until it is back to ok. A reminder lifts the item's existing alert back to the top, unread, so
-- the list does not fill with copies:
--   StockNotifications.ReminderCount   - how many reminders this row has had (0 = the first alert only)
--   StockNotifications.LastRemindedAt  - when the last reminder lifted it (null = never reminded)

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.StockNotifications', N'ReminderCount') IS NULL
BEGIN
    ALTER TABLE dbo.StockNotifications ADD ReminderCount INT NOT NULL
        CONSTRAINT DF_StockNotifications_ReminderCount DEFAULT 0;
END;
GO

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.StockNotifications', N'LastRemindedAt') IS NULL
BEGIN
    ALTER TABLE dbo.StockNotifications ADD LastRemindedAt DATETIME2(7) NULL;
END;
GO

IF OBJECT_ID(N'dbo.StockNotifications', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_StockNotifications_Item_User_Created' AND object_id = OBJECT_ID(N'dbo.StockNotifications'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockNotifications_Item_User_Created
        ON dbo.StockNotifications(ItemId, UserId, CreatedAt DESC);
END;
GO
