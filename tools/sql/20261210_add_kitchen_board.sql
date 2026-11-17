SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Kitchen board: the people who make the food and drinks see the orders still to make, and move each one through its own
-- steps. Those steps are separate from payment (Orders.StatusId is never read or changed by them).
--
--  1. Orders.KitchenStatus        - NULL not tracked (old orders, shop has the board off), 0 New, 1 Preparing, 2 Ready, 3 Served.
--     Orders.KitchenStartedAt     - when someone started making it.
--     Orders.KitchenServedAt      - when it was handed over.
--     Orders.KitchenUpdatedBy     - who made the last kitchen move.
--     Orders.KitchenChangedAt     - when the lines last changed after the kitchen had the order.
--     Orders.KitchenChangeNote    - the short "what changed" text shown on the card until the kitchen taps Seen.
--     Orders.KitchenChangeKind    - 1 changed, 2 added; NULL once seen.
--     Orders.KitchenDismissedAt   - set when the kitchen dismisses a "Cancelled, stop making" card.
--     There is no backfill: every order that exists today stays NULL (not tracked). ReadyAt is reused as the Ready time.
--  2. IX_Orders_Kitchen           - filtered index (TenantId, KitchenStatus) INCLUDE (CreatedAt) WHERE KitchenStatus < 3.
--  3. TenantSettings.KitchenBoardEnabled - per shop, default off. Turning it on affects new orders only.
--  4. The Kitchen system role (id 7). Its permissions (kitchen.read, kitchen.update) live in code, like the other system roles.
--  5. Plan feature word: kitchen. Pro and Business get it once (recorded in PlatformAuditLog as KitchenPlanFeature), so a plan
--     that Pogi later edits on the platform Plans page is not changed again by a second run. Starter is left alone.
-- The valid plan feature words are now: expenses, inventory, purchasing, promotions, orderlinks, chat, workbook, audit,
-- customroles, kitchen.
-- Run it after 20261203_add_order_item_quantity_check.sql. Safe to run twice; it never changes an existing order.

IF COL_LENGTH(N'dbo.Orders', N'KitchenStatus') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD KitchenStatus TINYINT NULL;
END
GO

IF COL_LENGTH(N'dbo.Orders', N'KitchenStartedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD KitchenStartedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH(N'dbo.Orders', N'KitchenServedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD KitchenServedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH(N'dbo.Orders', N'KitchenUpdatedBy') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD KitchenUpdatedBy UNIQUEIDENTIFIER NULL;
END
GO

IF COL_LENGTH(N'dbo.Orders', N'KitchenChangedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD KitchenChangedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH(N'dbo.Orders', N'KitchenChangeNote') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD KitchenChangeNote NVARCHAR(300) NULL;
END
GO

IF COL_LENGTH(N'dbo.Orders', N'KitchenChangeKind') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD KitchenChangeKind TINYINT NULL;
END
GO

IF COL_LENGTH(N'dbo.Orders', N'KitchenDismissedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD KitchenDismissedAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Orders_Kitchen' AND object_id = OBJECT_ID(N'dbo.Orders'))
BEGIN
    CREATE INDEX IX_Orders_Kitchen ON dbo.Orders (TenantId, KitchenStatus) INCLUDE (CreatedAt) WHERE KitchenStatus < 3;
END
GO

IF COL_LENGTH(N'dbo.TenantSettings', N'KitchenBoardEnabled') IS NULL
BEGIN
    ALTER TABLE dbo.TenantSettings ADD KitchenBoardEnabled BIT NOT NULL CONSTRAINT DF_TenantSettings_KitchenBoardEnabled DEFAULT (0);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE TenantId IS NULL AND Name = N'Kitchen')
   AND NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Id = 7)
BEGIN
    INSERT INTO dbo.UserRoles (Id, Name, IsSystem, TenantId, Description, CreatedAt)
    VALUES (7, N'Kitchen', 1, NULL, N'Sees the kitchen board only and moves orders through it.', SYSUTCDATETIME());
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PlatformAuditLog WHERE Action = 'KitchenPlanFeature')
BEGIN
    UPDATE dbo.Plans
    SET Features = CASE WHEN Features IS NULL OR LTRIM(RTRIM(Features)) = '' THEN 'kitchen' ELSE Features + ',kitchen' END
    WHERE Code IN ('pro', 'business')
      AND (Features IS NULL OR ',' + REPLACE(Features, ' ', '') + ',' NOT LIKE '%,kitchen,%');

    INSERT INTO dbo.PlatformAuditLog (Username, Action, Details)
    VALUES ('script', 'KitchenPlanFeature', N'20261210_add_kitchen_board.sql: the Pro and Business plans got the kitchen feature');
END
GO
