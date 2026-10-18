SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Orders sold offline are priced from today's catalog when they sync. When the catalog moved on in the
-- meantime (a product or add-on turned inactive, a price or a promotion changed, a bundle ended), the order is
-- held for an Admin to approve instead of being repriced or rejected:
--   Statuses.PendingReview  (id 6) - a synced offline order waiting for an Admin to approve or reject it
--   Orders.ReviewReasons           - why it was held, one reason per line (NULL = never held)
--   Orders.QuotedTotal             - the total the POS quoted the customer when the order was made offline
--   Orders.OfflineLocalId          - the POS queue number (for example OFF-261018-001). Unique, so a sync that is
--                                    sent twice (timeout, then retry) returns the saved order instead of a duplicate
-- Check the live Statuses data before running: this script assumes id 6 is free.

-- Orders.ReviewReasons
IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'ReviewReasons') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD ReviewReasons NVARCHAR(1000) NULL;
END;
GO

-- Orders.QuotedTotal
IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'QuotedTotal') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD QuotedTotal DECIMAL(18, 2) NULL;
END;
GO

-- Orders.OfflineLocalId
IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'OfflineLocalId') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD OfflineLocalId VARCHAR(40) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'OfflineLocalId') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'UX_Orders_OfflineLocalId' AND object_id = OBJECT_ID(N'dbo.Orders'))
BEGIN
    CREATE UNIQUE INDEX UX_Orders_OfflineLocalId
        ON dbo.Orders (OfflineLocalId)
        WHERE OfflineLocalId IS NOT NULL;
END;
GO

-- Statuses: PendingReview (id 6). Statuses.Id may be an identity column, so insert the id explicitly.
IF OBJECT_ID(N'dbo.Statuses', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.Statuses WHERE Id = 6)
BEGIN
    IF COLUMNPROPERTY(OBJECT_ID(N'dbo.Statuses'), N'Id', 'IsIdentity') = 1
    BEGIN
        SET IDENTITY_INSERT dbo.Statuses ON;
        INSERT INTO dbo.Statuses (Id, Name) VALUES (6, 'PendingReview');
        SET IDENTITY_INSERT dbo.Statuses OFF;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.Statuses (Id, Name) VALUES (6, 'PendingReview');
    END
END;
GO
