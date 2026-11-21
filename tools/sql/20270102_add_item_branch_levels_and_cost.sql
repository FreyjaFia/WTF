SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Multiple branches: stock levels and cost by branch (docs/roadmap/multiple-branches.md). Run after 20261230.
-- Each item still has one shop-wide warning level, critical level, par level and cost; those are the defaults. A branch can
-- set its own: ItemBranchStocks gets four nullable columns, and a null means "use the item's shop value". No data is
-- changed, so every branch keeps behaving as before until someone sets a branch value. Safe to run twice.

IF COL_LENGTH(N'dbo.ItemBranchStocks', N'WarningQuantity') IS NULL
BEGIN
    ALTER TABLE dbo.ItemBranchStocks ADD WarningQuantity DECIMAL(18, 3) NULL;
END
GO

IF COL_LENGTH(N'dbo.ItemBranchStocks', N'CriticalQuantity') IS NULL
BEGIN
    ALTER TABLE dbo.ItemBranchStocks ADD CriticalQuantity DECIMAL(18, 3) NULL;
END
GO

IF COL_LENGTH(N'dbo.ItemBranchStocks', N'ParLevel') IS NULL
BEGIN
    ALTER TABLE dbo.ItemBranchStocks ADD ParLevel DECIMAL(18, 3) NULL;
END
GO

IF COL_LENGTH(N'dbo.ItemBranchStocks', N'CostPrice') IS NULL
BEGIN
    ALTER TABLE dbo.ItemBranchStocks ADD CostPrice DECIMAL(18, 6) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_ItemBranchStock_Levels')
BEGIN
    ALTER TABLE dbo.ItemBranchStocks ADD CONSTRAINT CK_ItemBranchStock_Levels CHECK (
        (WarningQuantity IS NULL OR WarningQuantity >= 0)
        AND (CriticalQuantity IS NULL OR CriticalQuantity >= 0)
        AND (ParLevel IS NULL OR ParLevel >= 0)
        AND (CostPrice IS NULL OR CostPrice >= 0));
END
GO
