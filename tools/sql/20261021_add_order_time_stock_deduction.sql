SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Order-time stock deduction (Inventory Phase 1). Completing an order deducts the stock of the items its products are
-- linked to; voiding it puts the stock back, from the movements the sale wrote:
--   Items.AllowNegativeStock          - 1 (default) lets a sale take the balance below zero; 0 refuses an online sale that would
--   StockMovements.ProductId          - the product (or add-on) whose sale caused the movement, for usage per product
--   StockMovements.OrderItemId        - the order line when one line caused it. A snapshot, no foreign key: lines are rebuilt
--                                       when an order is edited
--   StockMovements.MovementType       - adds Sale, SaleVoid, Waste and Adjustment
-- The balance may go negative (a warn-only item, an offline sale, a count correction), so the checks that kept
-- Items.CurrentQuantity, StockMovements.QuantityBefore and QuantityAfter at zero or above are dropped. A blocking item is
-- protected by the guarded UPDATE the API uses, not by a table check, because an offline sale is honored whatever the balance.

-- Items.AllowNegativeStock
IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Items', N'AllowNegativeStock') IS NULL
BEGIN
    ALTER TABLE dbo.Items ADD AllowNegativeStock BIT NOT NULL
        CONSTRAINT DF_Items_AllowNegativeStock DEFAULT 1;
END;
GO

-- StockMovements.ProductId
IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.StockMovements', N'ProductId') IS NULL
BEGIN
    ALTER TABLE dbo.StockMovements ADD ProductId UNIQUEIDENTIFIER NULL;
END;
GO

IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.StockMovements', N'ProductId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_StockMovements_Products')
BEGIN
    ALTER TABLE dbo.StockMovements ADD CONSTRAINT FK_StockMovements_Products
        FOREIGN KEY (ProductId) REFERENCES dbo.Products(Id);
END;
GO

-- StockMovements.OrderItemId
IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.StockMovements', N'OrderItemId') IS NULL
BEGIN
    ALTER TABLE dbo.StockMovements ADD OrderItemId UNIQUEIDENTIFIER NULL;
END;
GO

-- (ReferenceType, ReferenceId): a void finds the movements of an order quickly
IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_StockMovements_Reference' AND object_id = OBJECT_ID(N'dbo.StockMovements'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockMovements_Reference
        ON dbo.StockMovements(ReferenceType, ReferenceId);
END;
GO

-- The balance may go below zero
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_CurrentQuantity')
BEGIN
    ALTER TABLE dbo.Items DROP CONSTRAINT CK_Items_CurrentQuantity;
END;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockMovements_QuantityBefore')
BEGIN
    ALTER TABLE dbo.StockMovements DROP CONSTRAINT CK_StockMovements_QuantityBefore;
END;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockMovements_QuantityAfter')
BEGIN
    ALTER TABLE dbo.StockMovements DROP CONSTRAINT CK_StockMovements_QuantityAfter;
END;
GO

-- Movement types: the new ones, and the old ones that existing rows may still use
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_StockMovements_MovementType')
   AND NOT EXISTS (
       SELECT 1 FROM sys.check_constraints
       WHERE name = N'CK_StockMovements_MovementType' AND definition LIKE N'%SaleVoid%')
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
            N'Adjustment',
            N'SaleDeduction',
            N'ManualAdjustment',
            N'Correction',
            N'Spoilage'
        )
    );
END;
GO
