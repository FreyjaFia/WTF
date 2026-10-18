SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Promotions get a weekly schedule and a usage limit, for all three types:
--   Promotions.DaysOfWeek      - bit mask of the days it runs on, Sunday = 1, Monday = 2 ... Saturday = 64
--                                (NULL = every day)
--   Promotions.StartTime       - shop-local time of day it starts (NULL = all day); with EndTime. A window whose end
--                                is earlier than its start runs past midnight. The end itself is not included.
--   Promotions.EndTime
--   Promotions.MaxRedemptions  - how many times it can be used in total (NULL = unlimited). A bundle counts its
--                                quantity, a discount counts the discounted items.
--   OrderItems.DiscountPromotionId - the discounted-product promotion that priced a line, so its uses can be counted.
--                                Bundles are already counted through OrderBundlePromotions.

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Promotions', N'DaysOfWeek') IS NULL
BEGIN
    ALTER TABLE dbo.Promotions ADD DaysOfWeek TINYINT NULL;
END;
GO

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Promotions', N'StartTime') IS NULL
BEGIN
    ALTER TABLE dbo.Promotions ADD StartTime TIME(0) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Promotions', N'EndTime') IS NULL
BEGIN
    ALTER TABLE dbo.Promotions ADD EndTime TIME(0) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Promotions', N'MaxRedemptions') IS NULL
BEGIN
    ALTER TABLE dbo.Promotions ADD MaxRedemptions INT NULL;
END;
GO

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Promotions', N'MaxRedemptions') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Promotions_Schedule')
BEGIN
    ALTER TABLE dbo.Promotions ADD CONSTRAINT CK_Promotions_Schedule CHECK (
        (DaysOfWeek IS NULL OR DaysOfWeek BETWEEN 1 AND 127)
        AND ((StartTime IS NULL AND EndTime IS NULL) OR (StartTime IS NOT NULL AND EndTime IS NOT NULL AND StartTime <> EndTime))
        AND (MaxRedemptions IS NULL OR MaxRedemptions > 0));
END;
GO

IF OBJECT_ID(N'dbo.OrderItems', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.OrderItems', N'DiscountPromotionId') IS NULL
BEGIN
    ALTER TABLE dbo.OrderItems ADD DiscountPromotionId UNIQUEIDENTIFIER NULL;
END;
GO

IF OBJECT_ID(N'dbo.OrderItems', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.OrderItems', N'DiscountPromotionId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_OrderItems_DiscountPromotion')
BEGIN
    ALTER TABLE dbo.OrderItems
        ADD CONSTRAINT FK_OrderItems_DiscountPromotion FOREIGN KEY (DiscountPromotionId) REFERENCES dbo.Promotions (Id);
END;
GO

IF OBJECT_ID(N'dbo.OrderItems', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.OrderItems', N'DiscountPromotionId') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_OrderItems_DiscountPromotionId' AND object_id = OBJECT_ID(N'dbo.OrderItems'))
BEGIN
    CREATE INDEX IX_OrderItems_DiscountPromotionId
        ON dbo.OrderItems (DiscountPromotionId)
        WHERE DiscountPromotionId IS NOT NULL;
END;
GO
