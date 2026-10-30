SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Recipe lines (Inventory Phase 6, slice 2). A product's links to items are its recipe: ProductItemLinks.QuantityPerSale is
-- the standard amount used per sale in the item's base unit. AllowancePercent adds a known, steady loss on top of it (the
-- spill that always happens when pouring): a sale uses QuantityPerSale x (1 + AllowancePercent / 100). 0 = no allowance.
-- Safe to run twice.

IF OBJECT_ID(N'dbo.ProductItemLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ProductItemLinks', N'AllowancePercent') IS NULL
BEGIN
    ALTER TABLE dbo.ProductItemLinks ADD AllowancePercent DECIMAL(5, 2) NOT NULL
        CONSTRAINT DF_ProductItemLinks_AllowancePercent DEFAULT 0;
END;
GO

IF OBJECT_ID(N'dbo.ProductItemLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ProductItemLinks', N'AllowancePercent') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_ProductItemLinks_AllowancePercent')
BEGIN
    ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT CK_ProductItemLinks_AllowancePercent
        CHECK (AllowancePercent >= 0 AND AllowancePercent <= 100);
END;
GO
