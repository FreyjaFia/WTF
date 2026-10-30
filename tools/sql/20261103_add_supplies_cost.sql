SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Supplies allowance (Inventory Phase 6, slice 5). Ice, straws, napkins and stirrers are not worth counting piece by piece.
-- Products.SuppliesCost is a fixed cost per sale for such things; it is added to the product's recipe cost and never touches
-- stock. 0 = none. Safe to run twice.

IF OBJECT_ID(N'dbo.Products', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Products', N'SuppliesCost') IS NULL
BEGIN
    ALTER TABLE dbo.Products ADD SuppliesCost DECIMAL(18, 6) NOT NULL
        CONSTRAINT DF_Products_SuppliesCost DEFAULT 0;
END;
GO

IF OBJECT_ID(N'dbo.Products', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Products', N'SuppliesCost') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Products_SuppliesCost')
BEGIN
    ALTER TABLE dbo.Products ADD CONSTRAINT CK_Products_SuppliesCost
        CHECK (SuppliesCost >= 0 AND SuppliesCost <= 9999.99);
END;
GO
