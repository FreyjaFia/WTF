SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Item costing (Inventory Phase 6, slice 1). A cost is kept per base unit (per ml, per g, per piece), so it needs more
-- decimals than money:
--   Items.CostPrice, StockMovements.UnitCost, ItemPriceHistory.OldPrice/NewPrice - widened to DECIMAL(18, 6).
--   Items.AverageCost  - the moving weighted average cost per base unit. Each stock-in with a cost recomputes it.
--                        NULL until a cost is known. Existing items start at their current CostPrice.
--   Items.YieldPercent - the usable share of what is bought (a fruit that is 80% usable after peeling). 100 = all of it.
-- Safe to run twice.

-- Items.CostPrice
IF COLUMNPROPERTY(OBJECT_ID(N'dbo.Items'), N'CostPrice', 'Scale') IS NOT NULL
   AND (COLUMNPROPERTY(OBJECT_ID(N'dbo.Items'), N'CostPrice', 'Scale') <> 6
        OR COLUMNPROPERTY(OBJECT_ID(N'dbo.Items'), N'CostPrice', 'Precision') <> 18)
BEGIN
    ALTER TABLE dbo.Items ALTER COLUMN CostPrice DECIMAL(18, 6) NULL;
END;
GO

-- StockMovements.UnitCost
IF COLUMNPROPERTY(OBJECT_ID(N'dbo.StockMovements'), N'UnitCost', 'Scale') IS NOT NULL
   AND (COLUMNPROPERTY(OBJECT_ID(N'dbo.StockMovements'), N'UnitCost', 'Scale') <> 6
        OR COLUMNPROPERTY(OBJECT_ID(N'dbo.StockMovements'), N'UnitCost', 'Precision') <> 18)
BEGIN
    ALTER TABLE dbo.StockMovements ALTER COLUMN UnitCost DECIMAL(18, 6) NULL;
END;
GO

-- ItemPriceHistory
IF COLUMNPROPERTY(OBJECT_ID(N'dbo.ItemPriceHistory'), N'OldPrice', 'Scale') IS NOT NULL
   AND (COLUMNPROPERTY(OBJECT_ID(N'dbo.ItemPriceHistory'), N'OldPrice', 'Scale') <> 6
        OR COLUMNPROPERTY(OBJECT_ID(N'dbo.ItemPriceHistory'), N'OldPrice', 'Precision') <> 18)
BEGIN
    ALTER TABLE dbo.ItemPriceHistory ALTER COLUMN OldPrice DECIMAL(18, 6) NULL;
END;
GO

IF COLUMNPROPERTY(OBJECT_ID(N'dbo.ItemPriceHistory'), N'NewPrice', 'Scale') IS NOT NULL
   AND (COLUMNPROPERTY(OBJECT_ID(N'dbo.ItemPriceHistory'), N'NewPrice', 'Scale') <> 6
        OR COLUMNPROPERTY(OBJECT_ID(N'dbo.ItemPriceHistory'), N'NewPrice', 'Precision') <> 18)
BEGIN
    ALTER TABLE dbo.ItemPriceHistory ALTER COLUMN NewPrice DECIMAL(18, 6) NOT NULL;
END;
GO

-- Items.AverageCost
IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Items', N'AverageCost') IS NULL
BEGIN
    ALTER TABLE dbo.Items ADD AverageCost DECIMAL(18, 6) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Items', N'AverageCost') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_AverageCost')
BEGIN
    ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_AverageCost
        CHECK (AverageCost IS NULL OR AverageCost >= 0);
END;
GO

-- Existing items start at the cost they already have.
IF COL_LENGTH(N'dbo.Items', N'AverageCost') IS NOT NULL
BEGIN
    EXEC(N'UPDATE dbo.Items SET AverageCost = CostPrice WHERE AverageCost IS NULL AND CostPrice IS NOT NULL');
END;
GO

-- Items.YieldPercent
IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Items', N'YieldPercent') IS NULL
BEGIN
    ALTER TABLE dbo.Items ADD YieldPercent DECIMAL(5, 2) NOT NULL
        CONSTRAINT DF_Items_YieldPercent DEFAULT 100;
END;
GO

IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Items', N'YieldPercent') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_YieldPercent')
BEGIN
    ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_YieldPercent
        CHECK (YieldPercent > 0 AND YieldPercent <= 100);
END;
GO
