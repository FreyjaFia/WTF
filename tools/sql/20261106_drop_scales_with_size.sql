SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- "Scales with size" is removed: a size's amounts are typed per size (ProductSizeAmounts), so nothing multiplies a recipe line
-- any more. Drops Products.RecipeMultiplier and ProductItemLinks.ScalesWithSize with their constraints. Safe to run more than once.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Products_RecipeMultiplier')
BEGIN
    ALTER TABLE dbo.Products DROP CONSTRAINT CK_Products_RecipeMultiplier;
END
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_Products_RecipeMultiplier')
BEGIN
    ALTER TABLE dbo.Products DROP CONSTRAINT DF_Products_RecipeMultiplier;
END
GO

IF COL_LENGTH(N'dbo.Products', N'RecipeMultiplier') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Products DROP COLUMN RecipeMultiplier;
END
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductItemLinks_ScalesWithSize')
BEGIN
    ALTER TABLE dbo.ProductItemLinks DROP CONSTRAINT DF_ProductItemLinks_ScalesWithSize;
END
GO

IF COL_LENGTH(N'dbo.ProductItemLinks', N'ScalesWithSize') IS NOT NULL
BEGIN
    ALTER TABLE dbo.ProductItemLinks DROP COLUMN ScalesWithSize;
END
GO
