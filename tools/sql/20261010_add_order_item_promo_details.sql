SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Keep the promotion that was applied to an order line, captured together with
-- OrderItems.Price (which is the already-discounted unit price):
--   OriginalPrice - the unit price before the promotion, so the discount is
--                   OriginalPrice - Price for any kind of promotion
--   PromoLabel    - the text describing the promotion (e.g. "Promo -P150.00"),
--                   written by the server, so new promotion types need no new columns
-- Without these the order details and summary can only guess the promotion from
-- whatever promotions happen to be active today.
IF OBJECT_ID(N'dbo.OrderItems', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.OrderItems', N'OriginalPrice') IS NULL
BEGIN
    ALTER TABLE dbo.OrderItems ADD OriginalPrice DECIMAL(10, 2) NULL;
END;
GO

IF OBJECT_ID(N'dbo.OrderItems', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.OrderItems', N'PromoLabel') IS NULL
BEGIN
    ALTER TABLE dbo.OrderItems ADD PromoLabel NVARCHAR(100) NULL;
END;
GO
