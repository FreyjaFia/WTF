SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Flat ingredient amounts per size (Inventory Phase 6, Ingredients & Cost page, slice C).
--   A size add-on such as Large is one shared product used by many drinks, so an amount on its own link would hit every drink.
--   Each row says: on THIS drink (ProductId), when THIS size (SizeProductId) is on the sale, THIS item (ItemId) uses Quantity.
--   The size amount replaces the drink's base amount for that item. Rows are switched off (IsActive = 0), never deleted.
-- Safe to run twice.

IF OBJECT_ID(N'dbo.ProductSizeAmounts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductSizeAmounts
    (
        Id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ProductSizeAmounts_Id DEFAULT (NEWID()),
        ProductId     UNIQUEIDENTIFIER NOT NULL,
        SizeProductId UNIQUEIDENTIFIER NOT NULL,
        ItemId        UNIQUEIDENTIFIER NOT NULL,
        Quantity      DECIMAL(18, 3)   NOT NULL,
        IsActive      BIT              NOT NULL CONSTRAINT DF_ProductSizeAmounts_IsActive DEFAULT 1,
        CreatedAt     DATETIME2        NOT NULL CONSTRAINT DF_ProductSizeAmounts_CreatedAt DEFAULT (GETUTCDATE()),
        CreatedBy     UNIQUEIDENTIFIER NOT NULL,
        UpdatedAt     DATETIME2        NULL,
        UpdatedBy     UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_ProductSizeAmounts PRIMARY KEY (Id),
        CONSTRAINT FK_ProductSizeAmounts_Products FOREIGN KEY (ProductId) REFERENCES dbo.Products (Id),
        CONSTRAINT FK_ProductSizeAmounts_SizeProducts FOREIGN KEY (SizeProductId) REFERENCES dbo.Products (Id),
        CONSTRAINT FK_ProductSizeAmounts_Items FOREIGN KEY (ItemId) REFERENCES dbo.Items (Id),
        CONSTRAINT FK_ProductSizeAmounts_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users (Id),
        CONSTRAINT FK_ProductSizeAmounts_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users (Id),
        CONSTRAINT CK_ProductSizeAmounts_Quantity CHECK (Quantity > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.ProductSizeAmounts', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ProductSizeAmounts_Product_Size_Item')
BEGIN
    CREATE UNIQUE INDEX UX_ProductSizeAmounts_Product_Size_Item
        ON dbo.ProductSizeAmounts (ProductId, SizeProductId, ItemId);
END;
GO

IF OBJECT_ID(N'dbo.ProductSizeAmounts', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductSizeAmounts_ItemId')
BEGIN
    CREATE INDEX IX_ProductSizeAmounts_ItemId ON dbo.ProductSizeAmounts (ItemId);
END;
GO
