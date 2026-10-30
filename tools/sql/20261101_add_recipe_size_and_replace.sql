SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Recipes that follow the size and the add-ons (Inventory Phase 6, slice 3).
--   Products.RecipeMultiplier       - for a Size add-on: how much of a drink's "scales with size" recipe lines a sale uses
--                                     (Large = 1.5 means 1.5x the milk). 1 = no change. Other products keep 1.
--   ProductItemLinks.ScalesWithSize - this recipe line is multiplied by the size add-on on the same drink (milk and beans
--                                     scale; a lid or a cup that never changes does not).
--   ProductItemLinks.ReplacesItemId - on an add-on's line: when the add-on is on a drink, the drink's own line for that item is
--                                     not taken (oat milk replaces dairy milk instead of adding to it).
-- Safe to run twice.

IF OBJECT_ID(N'dbo.Products', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Products', N'RecipeMultiplier') IS NULL
BEGIN
    ALTER TABLE dbo.Products ADD RecipeMultiplier DECIMAL(6, 3) NOT NULL
        CONSTRAINT DF_Products_RecipeMultiplier DEFAULT 1;
END;
GO

IF OBJECT_ID(N'dbo.Products', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Products', N'RecipeMultiplier') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Products_RecipeMultiplier')
BEGIN
    ALTER TABLE dbo.Products ADD CONSTRAINT CK_Products_RecipeMultiplier
        CHECK (RecipeMultiplier > 0 AND RecipeMultiplier <= 10);
END;
GO

IF OBJECT_ID(N'dbo.ProductItemLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ProductItemLinks', N'ScalesWithSize') IS NULL
BEGIN
    ALTER TABLE dbo.ProductItemLinks ADD ScalesWithSize BIT NOT NULL
        CONSTRAINT DF_ProductItemLinks_ScalesWithSize DEFAULT 0;
END;
GO

IF OBJECT_ID(N'dbo.ProductItemLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ProductItemLinks', N'ReplacesItemId') IS NULL
BEGIN
    ALTER TABLE dbo.ProductItemLinks ADD ReplacesItemId UNIQUEIDENTIFIER NULL;
END;
GO

IF OBJECT_ID(N'dbo.ProductItemLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ProductItemLinks', N'ReplacesItemId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductItemLinks_ReplacesItem')
BEGIN
    ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT FK_ProductItemLinks_ReplacesItem
        FOREIGN KEY (ReplacesItemId) REFERENCES dbo.Items(Id);
END;
GO
