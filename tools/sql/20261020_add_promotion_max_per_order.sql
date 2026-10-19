SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- A promotion can limit how much of it one order may use:
--   Promotions.MaxPerOrder - the most items of a discount (or the most of a bundle) a single order can get at the
--                            promotion's price (NULL = no limit per order). A discounted line above it is charged full
--                            price for the rest.

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Promotions', N'MaxPerOrder') IS NULL
BEGIN
    ALTER TABLE dbo.Promotions ADD MaxPerOrder INT NULL;
END;
GO

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Promotions', N'MaxPerOrder') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Promotions_MaxPerOrder')
BEGIN
    ALTER TABLE dbo.Promotions ADD CONSTRAINT CK_Promotions_MaxPerOrder CHECK (MaxPerOrder IS NULL OR MaxPerOrder > 0);
END;
GO
