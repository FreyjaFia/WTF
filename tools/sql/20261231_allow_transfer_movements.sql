-- Stock transfers write TransferOut and TransferIn movements: widen the movement type check.
-- Safe to run twice. Run after 20261230_add_item_branch_stocks.sql.

-- Movement types: add TransferOut and TransferIn
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockMovements_MovementType')
   AND NOT EXISTS (
       SELECT 1 FROM sys.check_constraints
       WHERE name = N'CK_StockMovements_MovementType' AND definition LIKE N'%TransferOut%')
BEGIN
    ALTER TABLE dbo.StockMovements DROP CONSTRAINT CK_StockMovements_MovementType;
END;
GO

IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockMovements_MovementType')
BEGIN
    ALTER TABLE dbo.StockMovements ADD CONSTRAINT CK_StockMovements_MovementType CHECK (
        MovementType IN (
            N'AddStock',
            N'Sale',
            N'SaleVoid',
            N'Waste',
            N'WasteReversed',
            N'Adjustment',
            N'Count',
            N'SaleDeduction',
            N'ManualAdjustment',
            N'Correction',
            N'Spoilage',
            N'TransferOut',
            N'TransferIn'
        )
    );
END;
GO
