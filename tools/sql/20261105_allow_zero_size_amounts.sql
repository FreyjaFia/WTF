SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- A size can say "this ingredient is not used here" with an amount of 0 (for example the 16oz cup on a Large drink).
-- ProductSizeAmounts.Quantity was required to be above 0; it may now be 0 or more. Safe to run more than once.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ProductSizeAmounts_Quantity' AND definition LIKE '%>(0)%')
BEGIN
    ALTER TABLE dbo.ProductSizeAmounts DROP CONSTRAINT CK_ProductSizeAmounts_Quantity;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ProductSizeAmounts_Quantity')
BEGIN
    ALTER TABLE dbo.ProductSizeAmounts ADD CONSTRAINT CK_ProductSizeAmounts_Quantity CHECK (Quantity >= 0);
END
GO
